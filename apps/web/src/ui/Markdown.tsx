import { Fragment, createContext, useContext, useState, type ReactNode } from 'react'
import type { Block, MarkdownNode } from '../lib/markdown'
import { render as parse, type RenderOptions } from '../lib/markdown'

/**
 * A message on the page.
 *
 * There is no `dangerouslySetInnerHTML` here and there must never be one.
 * Every piece of what somebody wrote arrives as a text node, which the
 * renderer puts into the document as text — so a message containing a `<img
 * onerror=...>` is a message about an img tag, and cannot be anything else.
 *
 * That is the whole difference from the old renderer, which built a string of
 * markup and relied on every value having been passed through `esc` by
 * somebody who remembered to.
 */

/*
 * How to open the person a mention names.
 *
 * Through a context rather than a prop: a mention can be four levels deep in
 * emphasis and quotes, and threading a callback through every one of them
 * means every component in this file takes an argument it does not use.
 */
const OpenWho = createContext<((id: string, el: Element) => void) | null>(null)

const WRAP: Record<string, keyof JSX.IntrinsicElements> = {
  b: 'b', i: 'i', u: 'u', s: 's',
}

function Piece({ node }: { node: MarkdownNode }): ReactNode {
  const openWho = useContext(OpenWho)
  switch (node.k) {
    case 'text':
      return node.text
    case 'code':
      return <code className="mdcode">{node.text}</code>
    case 'pre':
      return <pre className="mdpre">{node.text}</pre>
    case 'link':
      /* The href was checked when it was parsed — anything that is not
         plainly http or https never became a link at all. */
      return (
        <a className="mdlink" href={node.href} target="_blank" rel="noopener noreferrer">
          {node.text}
        </a>
      )
    case 'mention':
      /* A person, so it opens them — it was text shaped like a control, which
         is worse than no control at all. Still a plain span where there is
         nobody to open, so an @ nobody answers to is not a dead button. */
      /* A role is not somebody to open — it is a group, and there is no
         card for a group. Drawn in its own colour so it reads as the role it
         names rather than as a person. */
      if (node.role) {
        return (
          <span
            className={node.me ? 'mention role me' : 'mention role'}
            style={node.colour ? { '--role': node.colour } as React.CSSProperties : undefined}
          >
            @{node.name}
          </span>
        )
      }
      return node.id && openWho
        ? (
          <button
            type="button"
            className={node.me ? 'mention me' : 'mention'}
            data-who={node.id}
            onClick={(e) => openWho(node.id as string, e.currentTarget)}
          >
            @{node.name}
          </button>
        )
        : (
          <span className={node.me ? 'mention me' : 'mention'} data-who={node.name}>
            @{node.name}
          </span>
        )
    case 'emphasis': {
      const kids = <Pieces nodes={node.kids} />
      if (node.style === 'spoiler') {
        return <Spoiler>{kids}</Spoiler>
      }
      const Tag = WRAP[node.style] ?? 'span'
      return <Tag>{kids}</Tag>
    }
  }
}

/**
 * Hidden until asked for.
 *
 * The stylesheet has always had a `.spo.open` that shows the words, and
 * nothing ever put that class on anything — so a spoiler was a block of
 * unreadable text with no way to read it. Its own state rather than a class
 * toggled from outside: each one opens on its own, and closing the message
 * and opening it again hides them all once more, which is what somebody
 * scrolling back past a spoiler expects.
 */
function Spoiler({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <span
      className={open ? 'spo open' : 'spo'}
      data-spoil
      role={open ? undefined : 'button'}
      tabIndex={open ? undefined : 0}
      aria-label={open ? undefined : 'Show the hidden text'}
      onClick={() => setOpen(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(true) }
      }}
    >
      {children}
    </span>
  )
}

function Pieces({ nodes }: { nodes: MarkdownNode[] }): ReactNode {
  return nodes.map((n, i) => <Fragment key={i}><Piece node={n} /></Fragment>)
}

function Line({ block }: { block: Block }): ReactNode {
  if (block.k === 'quote') {
    return (
      <blockquote className="mdq">
        {block.lines.map((line, i) => (
          <Fragment key={i}>
            {i > 0 && <br />}
            <Pieces nodes={line} />
          </Fragment>
        ))}
      </blockquote>
    )
  }
  return <Pieces nodes={block.kids} />
}

export function Markdown({ text, options, onWho }: {
  text: string
  options?: RenderOptions | undefined
  /** Given, every mention of somebody known becomes a way to open them. */
  onWho?: ((id: string, el: Element) => void) | undefined
}) {
  const blocks = parse(text, options)
  return (
    <OpenWho.Provider value={onWho ?? null}>
      {blocks.map((b, i) => (
        <Fragment key={i}>
          {i > 0 && b.k === 'line' && <br />}
          <Line block={b} />
        </Fragment>
      ))}
    </OpenWho.Provider>
  )
}
