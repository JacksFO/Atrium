// Per-application audio capture, for screen sharing.
//
// Sharing a window has always been silent, and sharing a whole screen sends
// everything the machine is playing - notifications, another call, whatever
// is in the other browser tab. Neither is what somebody streaming a game
// wants. Windows can capture a single process tree, but only through an API
// no browser exposes, which is why this exists at all.
//
// The interesting call is ActivateAudioInterfaceAsync against the pseudo
// device VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, with activation parameters
// naming the process. It hands back an ordinary IAudioClient afterwards, so
// everything past that point is a normal loopback capture.
//
// Needs Windows 10 build 20348 or later. Older ones fail the activation
// rather than crashing, and the JavaScript side turns that into a message.

#include <napi.h>

#include <windows.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <audioclientactivationparams.h>
#include <audiopolicy.h>
#include <psapi.h>
#include <wrl/implements.h>

#include <atomic>
#include <string>
#include <thread>
#include <vector>

using Microsoft::WRL::ComPtr;

namespace {

/** What we ask for, rather than what a device happens to offer. */
constexpr int kSampleRate = 48000;
constexpr int kChannels = 2;
constexpr int kBits = 16;

std::string Narrow(const std::wstring& wide) {
  if (wide.empty()) return {};
  int size = WideCharToMultiByte(CP_UTF8, 0, wide.data(), (int)wide.size(),
                                 nullptr, 0, nullptr, nullptr);
  std::string out(size, 0);
  WideCharToMultiByte(CP_UTF8, 0, wide.data(), (int)wide.size(),
                      out.data(), size, nullptr, nullptr);
  return out;
}

/**
 * Activation is asynchronous, and this is how it reports back.
 *
 * The caller waits on the event rather than pumping messages: this runs on
 * a worker thread of ours, not on a UI thread with a message loop.
 */
class ActivationHandler
    : public Microsoft::WRL::RuntimeClass<
          Microsoft::WRL::RuntimeClassFlags<Microsoft::WRL::ClassicCom>,
          // Agile, via the free-threaded marshaller. Without it the
          // activation is refused outright with "a method was called at an
          // unexpected time", which is a confusing way of being told the
          // handler cannot be called on the thread that would call it.
          Microsoft::WRL::FtmBase,
          IActivateAudioInterfaceCompletionHandler> {
 public:
  HANDLE done = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  HRESULT result = E_FAIL;
  ComPtr<IAudioClient> client;

  ~ActivationHandler() {
    if (done) CloseHandle(done);
  }

  STDMETHODIMP ActivateCompleted(
      IActivateAudioInterfaceAsyncOperation* operation) override {
    HRESULT hr = E_FAIL;
    ComPtr<IUnknown> unknown;
    HRESULT called = operation->GetActivateResult(&hr, &unknown);
    if (SUCCEEDED(called) && SUCCEEDED(hr) && unknown) {
      unknown.As(&client);
      result = S_OK;
    } else {
      result = FAILED(called) ? called : hr;
    }
    SetEvent(done);
    return S_OK;
  }
};

/**
 * One capture, running until it is told to stop.
 *
 * Only one at a time is supported on purpose: a share has one source of
 * sound, and letting several run would mean deciding how to mix them, which
 * is a decision belonging further up.
 */
class Capture {
 public:
  bool Start(DWORD pid, Napi::Env env, Napi::Function onData, std::string* error);
  void Stop();
  bool Running() const { return running_.load(); }

 private:
  void Run(DWORD pid);

  std::thread thread_;
  std::atomic<bool> running_{false};
  std::atomic<bool> stopping_{false};
  Napi::ThreadSafeFunction emit_;
  // Set by the worker once activation has been attempted, so Start() can
  // report a failure rather than returning to a caller that will never
  // hear anything.
  HANDLE ready_ = nullptr;
  std::atomic<bool> ok_{false};
  std::string startError_;
};

bool Capture::Start(DWORD pid, Napi::Env env, Napi::Function onData,
                    std::string* error) {
  if (running_.load()) {
    *error = "already capturing";
    return false;
  }

  emit_ = Napi::ThreadSafeFunction::New(env, onData, "appaudio", 0, 1);
  ready_ = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  stopping_.store(false);
  running_.store(true);

  thread_ = std::thread([this, pid] { Run(pid); });

  WaitForSingleObject(ready_, 5000);

  if (!ok_.load()) {
    /**
     * Join before closing, always.
     *
     * Closing the handle here and letting the worker carry on meant it
     * could signal an event that had already been shut - and on a timeout,
     * read the error string while the worker was still writing it. Waiting
     * for the thread first makes both questions moot.
     */
    stopping_.store(true);
    if (thread_.joinable()) thread_.join();
    CloseHandle(ready_);
    ready_ = nullptr;
    running_.store(false);
    emit_.Release();
    *error = startError_.empty() ? "could not start capturing that program" : startError_;
    return false;
  }
  // Left open on purpose: the worker signalled it once and never touches it
  // again, and Stop closes it after joining.
  return true;
}

void Capture::Stop() {
  if (!running_.load()) return;
  stopping_.store(true);
  if (thread_.joinable()) thread_.join();
  if (ready_) {
    CloseHandle(ready_);
    ready_ = nullptr;
  }
  running_.store(false);
  emit_.Release();
}

void Capture::Run(DWORD pid) {
  auto fail = [&](const char* what, HRESULT hr) {
    startError_ = std::string(what) + " (0x" + [hr] {
      char buf[16];
      snprintf(buf, sizeof(buf), "%08lx", (unsigned long)hr);
      return std::string(buf);
    }() + ")";
    ok_.store(false);
    if (ready_) SetEvent(ready_);
  };

  HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  const bool comStarted = SUCCEEDED(hr);

  AUDIOCLIENT_ACTIVATION_PARAMS params = {};
  params.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
  params.ProcessLoopbackParams.TargetProcessId = pid;
  // The tree, not the single process: a game with a launcher or a browser
  // with one process per tab would otherwise capture silence.
  params.ProcessLoopbackParams.ProcessLoopbackMode =
      PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE;

  PROPVARIANT activation = {};
  activation.vt = VT_BLOB;
  activation.blob.cbSize = sizeof(params);
  activation.blob.pBlobData = reinterpret_cast<BYTE*>(&params);

  ComPtr<ActivationHandler> handler = Microsoft::WRL::Make<ActivationHandler>();
  ComPtr<IActivateAudioInterfaceAsyncOperation> operation;

  hr = ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
                                   __uuidof(IAudioClient), &activation,
                                   handler.Get(), &operation);
  if (FAILED(hr)) {
    fail(hr == E_NOTIMPL || hr == E_NOINTERFACE
             ? "this version of Windows cannot capture one program's audio"
             : "could not ask Windows to capture that program",
         hr);
    if (comStarted) CoUninitialize();
    return;
  }

  WaitForSingleObject(handler->done, 5000);
  if (FAILED(handler->result) || !handler->client) {
    fail("Windows refused to capture that program", handler->result);
    if (comStarted) CoUninitialize();
    return;
  }

  WAVEFORMATEX format = {};
  format.wFormatTag = WAVE_FORMAT_PCM;
  format.nChannels = kChannels;
  format.nSamplesPerSec = kSampleRate;
  format.wBitsPerSample = kBits;
  format.nBlockAlign = format.nChannels * format.wBitsPerSample / 8;
  format.nAvgBytesPerSec = format.nSamplesPerSec * format.nBlockAlign;
  format.cbSize = 0;

  // A process loopback endpoint has no mix format to ask about, so the
  // format is stated rather than negotiated.
  hr = handler->client->Initialize(
      AUDCLNT_SHAREMODE_SHARED,
      AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
      2000000,  // 200ms, in 100ns units
      0, &format, nullptr);
  if (FAILED(hr)) {
    fail("could not open an audio stream for that program", hr);
    if (comStarted) CoUninitialize();
    return;
  }

  HANDLE audioReady = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  hr = handler->client->SetEventHandle(audioReady);
  if (FAILED(hr)) {
    fail("could not listen for audio", hr);
    CloseHandle(audioReady);
    if (comStarted) CoUninitialize();
    return;
  }

  ComPtr<IAudioCaptureClient> capture;
  hr = handler->client->GetService(IID_PPV_ARGS(&capture));
  if (FAILED(hr)) {
    fail("could not read the audio stream", hr);
    CloseHandle(audioReady);
    if (comStarted) CoUninitialize();
    return;
  }

  hr = handler->client->Start();
  if (FAILED(hr)) {
    fail("could not start the audio stream", hr);
    CloseHandle(audioReady);
    if (comStarted) CoUninitialize();
    return;
  }

  ok_.store(true);
  if (ready_) SetEvent(ready_);

  while (!stopping_.load()) {
    // A timeout rather than an infinite wait: a program that is playing
    // nothing produces no events at all, and stopping should not have to
    // wait for it to make a sound first.
    if (WaitForSingleObject(audioReady, 200) != WAIT_OBJECT_0) continue;

    UINT32 frames = 0;
    while (SUCCEEDED(capture->GetNextPacketSize(&frames)) && frames > 0) {
      BYTE* data = nullptr;
      UINT32 got = 0;
      DWORD flags = 0;
      if (FAILED(capture->GetBuffer(&data, &got, &flags, nullptr, nullptr))) break;

      const size_t bytes = (size_t)got * format.nBlockAlign;
      std::vector<uint8_t> chunk(bytes);
      if (flags & AUDCLNT_BUFFERFLAGS_SILENT) {
        // Silence is delivered as a flag and a buffer of nothing in
        // particular. Sending real zeroes keeps the stream continuous,
        // which is what the far end needs to stay in time.
        std::fill(chunk.begin(), chunk.end(), 0);
      } else if (data != nullptr) {
        std::copy(data, data + bytes, chunk.begin());
      }
      capture->ReleaseBuffer(got);

      if (bytes == 0) continue;
      emit_.BlockingCall(
          new std::vector<uint8_t>(std::move(chunk)),
          [](Napi::Env env, Napi::Function cb, std::vector<uint8_t>* owned) {
            Napi::Buffer<uint8_t> buffer =
                Napi::Buffer<uint8_t>::Copy(env, owned->data(), owned->size());
            delete owned;
            cb.Call({buffer});
          });
    }
  }

  handler->client->Stop();
  CloseHandle(audioReady);
  if (comStarted) CoUninitialize();
}

Capture g_capture;

// ------------------------------------------------------------- sessions ---

/** The name of a process, for a list somebody has to choose from. */
std::string ProcessName(DWORD pid) {
  HANDLE process =
      OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (!process) return {};
  wchar_t path[MAX_PATH] = {};
  DWORD size = MAX_PATH;
  std::string name;
  if (QueryFullProcessImageNameW(process, 0, path, &size)) {
    std::wstring full(path, size);
    const size_t slash = full.find_last_of(L"\\/");
    name = Narrow(slash == std::wstring::npos ? full : full.substr(slash + 1));
  }
  CloseHandle(process);
  return name;
}

/**
 * Everything currently playing sound, as Windows sees it.
 *
 * Read off the default output device's session list, which is the same set
 * the volume mixer shows - so what somebody picks here matches what they
 * are used to seeing.
 */
Napi::Value Sessions(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Array out = Napi::Array::New(env);

  HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  const bool comStarted = SUCCEEDED(hr);

  ComPtr<IMMDeviceEnumerator> enumerator;
  hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL,
                        IID_PPV_ARGS(&enumerator));
  if (FAILED(hr)) {
    if (comStarted) CoUninitialize();
    return out;
  }

  ComPtr<IMMDevice> device;
  if (FAILED(enumerator->GetDefaultAudioEndpoint(eRender, eConsole, &device))) {
    if (comStarted) CoUninitialize();
    return out;
  }

  ComPtr<IAudioSessionManager2> manager;
  if (FAILED(device->Activate(__uuidof(IAudioSessionManager2), CLSCTX_ALL, nullptr,
                              reinterpret_cast<void**>(manager.GetAddressOf())))) {
    if (comStarted) CoUninitialize();
    return out;
  }

  ComPtr<IAudioSessionEnumerator> sessions;
  if (FAILED(manager->GetSessionEnumerator(&sessions))) {
    if (comStarted) CoUninitialize();
    return out;
  }

  int count = 0;
  sessions->GetCount(&count);
  uint32_t written = 0;

  for (int i = 0; i < count; i++) {
    ComPtr<IAudioSessionControl> control;
    if (FAILED(sessions->GetSession(i, &control))) continue;
    ComPtr<IAudioSessionControl2> control2;
    if (FAILED(control.As(&control2))) continue;

    DWORD pid = 0;
    if (FAILED(control2->GetProcessId(&pid)) || pid == 0) continue;
    // The system session has no process worth naming and cannot be captured.
    if (control2->IsSystemSoundsSession() == S_OK) continue;

    const std::string name = ProcessName(pid);
    if (name.empty()) continue;

    AudioSessionState state = AudioSessionStateInactive;
    control->GetState(&state);

    Napi::Object entry = Napi::Object::New(env);
    entry.Set("pid", Napi::Number::New(env, (double)pid));
    entry.Set("name", Napi::String::New(env, name));
    entry.Set("active", Napi::Boolean::New(env, state == AudioSessionStateActive));
    out.Set(written++, entry);
  }

  if (comStarted) CoUninitialize();
  return out;
}

/**
 * Which process owns a window.
 *
 * The whole point of the picker knowing this: somebody chooses a window to
 * share, and the sound of the program that owns it follows without their
 * being asked a second question about the same thing.
 *
 * The window is named by handle, because that is what the source list hands
 * back - a source id of "window:3410560:0" is a handle in decimal.
 */
Napi::Value PidForWindow(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsNumber()) {
    Napi::TypeError::New(env, "pidForWindow(handle)").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  const auto handle = reinterpret_cast<HWND>(
      static_cast<uintptr_t>(info[0].As<Napi::Number>().Int64Value()));
  if (!IsWindow(handle)) return env.Null();

  DWORD pid = 0;
  GetWindowThreadProcessId(handle, &pid);
  if (pid == 0) return env.Null();
  return Napi::Number::New(env, static_cast<double>(pid));
}

// ---------------------------------------------------------------- start ---

Napi::Value Start(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsFunction()) {
    Napi::TypeError::New(env, "start(pid, onData)").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  const DWORD pid = (DWORD)info[0].As<Napi::Number>().Uint32Value();
  std::string error;
  if (!g_capture.Start(pid, env, info[1].As<Napi::Function>(), &error)) {
    Napi::Error::New(env, error).ThrowAsJavaScriptException();
    return env.Undefined();
  }
  return env.Undefined();
}

Napi::Value Stop(const Napi::CallbackInfo& info) {
  g_capture.Stop();
  return info.Env().Undefined();
}

Napi::Value Running(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), g_capture.Running());
}

Napi::Value Format(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Object out = Napi::Object::New(env);
  out.Set("sampleRate", Napi::Number::New(env, kSampleRate));
  out.Set("channels", Napi::Number::New(env, kChannels));
  out.Set("bitsPerSample", Napi::Number::New(env, kBits));
  return out;
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("sessions", Napi::Function::New(env, Sessions));
  exports.Set("pidForWindow", Napi::Function::New(env, PidForWindow));
  exports.Set("start", Napi::Function::New(env, Start));
  exports.Set("stop", Napi::Function::New(env, Stop));
  exports.Set("running", Napi::Function::New(env, Running));
  exports.Set("format", Napi::Function::New(env, Format));
  return exports;
}

}  // namespace

NODE_API_MODULE(appaudio, Init)
