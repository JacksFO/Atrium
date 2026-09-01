import { useState } from 'react'
import { Modal } from './Modal'
import { Icon } from './Icon'

/**
 * Asking a question.
 *
 * Three answers to begin with, because two is the least a question can have
 * and three is what most of them want — starting at two means everybody adds
 * one, and starting at five means everybody deletes two.
 */

/** How long it may run. Minutes, so the server never takes an absolute time
 *  from a client — one in the past would be a poll that arrives closed. */
const HOW_LONG: ReadonlyArray<readonly [number, string]> = [
  [60, '1 hour'],
  [4 * 60, '4 hours'],
  [8 * 60, '8 hours'],
  [24 * 60, '1 day'],
  [3 * 24 * 60, '3 days'],
  [7 * 24 * 60, '1 week'],
  [0, 'No limit'],
]

const MOST = 10

export function PollMaker({ onAsk, onClose }: {
  onAsk: (poll: { question: string; options: string[]; multi: boolean; minutes: number }) => void
  onClose: () => void
}) {
  const [question, setQuestion] = useState('')
  const [answers, setAnswers] = useState(['', '', ''])
  const [multi, setMulti] = useState(false)
  const [minutes, setMinutes] = useState(24 * 60)

  const real = answers.map((a) => a.trim()).filter(Boolean)
  const ready = question.trim().length > 0 && real.length >= 2

  const set = (i: number, text: string) =>
    setAnswers((was) => was.map((a, j) => (j === i ? text : a)))

  return (
    <Modal
      title="Ask a question"
      onClose={onClose}
      actions={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn p" disabled={!ready} onClick={() => {
            onAsk({ question: question.trim(), options: real, multi, minutes })
          }}>
            Ask
          </button>
        </>
      }
    >
      <div className="fld">
        <label>Question</label>
        <input value={question} autoFocus maxLength={200}
          placeholder="Where are we playing tonight?"
          onChange={(e) => setQuestion(e.target.value)} />
      </div>

      <div className="fld">
        <label>Answers</label>
        <div className="answers">
          {answers.map((a, i) => (
            <span className="answer" key={i}>
              <input value={a} maxLength={80}
                placeholder={`Answer ${i + 1}`}
                onChange={(e) => set(i, e.target.value)} />
              {/* Removable down to two, which is the fewest a question can
                  have. Below that it is not a question. */}
              {answers.length > 2 && (
                <button className="icb" aria-label={`Remove answer ${i + 1}`}
                  onClick={() => setAnswers((was) => was.filter((_, j) => j !== i))}>
                  <Icon name="x" size={14} />
                </button>
              )}
            </span>
          ))}
        </div>
        {answers.length < MOST && (
          <button className="btn" style={{ marginTop: 8 }}
            onClick={() => setAnswers((was) => [...was, ''])}>
            <Icon name="plus" size={14} /> Add an answer
          </button>
        )}
      </div>

      <div className="row">
        <span className="txt">
          <span className="t">More than one answer</span>
          <span className="d">People may pick as many as they like.</span>
        </span>
        <button className={multi ? 'sw on' : 'sw'} role="switch" aria-checked={multi}
          aria-label="More than one answer" onClick={() => setMulti(!multi)} />
      </div>

      <div className="row">
        <span className="txt">
          <span className="t">Time limit</span>
          <span className="d">After this it stops taking answers and keeps them.</span>
        </span>
        <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
          {HOW_LONG.map(([m, label]) => (
            <option key={m} value={m}>{label}</option>
          ))}
        </select>
      </div>
    </Modal>
  )
}
