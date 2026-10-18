import Link from 'next/link';
import { Sparkles } from 'lucide-react';

export function ChatGPTPanel({ standalone, handle }: { standalone: boolean; handle: string }) {
  return (
    <section className="chat-panel">
      <div className="chat-panel-symbol">
        <Sparkles size={32} />
      </div>
      <h2>Your space. In your own words.</h2>
      <p>
        Connect wya.im in ChatGPT, then name the space you want to change. Each space has its own
        profile, links, and history.
      </p>
      {standalone ? (
        <>
          <ol>
            <li>
              Create a custom connection in ChatGPT with <strong>https://wya.im/mcp</strong>.
            </li>
            <li>
              Choose OAuth, leave the client ID and secret blank, then sign in with your email code
              and review access.
            </li>
            <li>Start a conversation and select wya.im.</li>
          </ol>
          <p className="subtle">
            Custom connections depend on your ChatGPT account or workspace. Manage access from{' '}
            <Link href="/connections">Your connections</Link>.
          </p>
        </>
      ) : (
        <ol>
          <li>Open ChatGPT&apos;s plugin settings.</li>
          <li>
            Find <strong>wya.im</strong> in your available plugins and connect it. During this
            private preview, access is limited to the site owner.
          </li>
          <li>Start a conversation and mention wya.im.</li>
        </ol>
      )}
      <div className="prompt-examples">
        <p>“List my wya.im spaces.”</p>
        <p>“Add my GitHub to my @{handle} space.”</p>
        <p>“Move my portfolio to the top.”</p>
        <p>“Undo my last profile change.”</p>
      </div>
      <p className="subtle">
        Every update belongs to your signed-in account. You can review and restore previous versions
        in Change history.
      </p>
    </section>
  );
}
