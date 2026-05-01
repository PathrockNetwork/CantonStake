import Link from "next/link";
import { Card } from "@/components/Card";

type EmptyStateProps = {
  title: string;
  body: string;
  actionHref?: string;
  actionLabel?: string;
};

export function EmptyState({ title, body, actionHref, actionLabel }: EmptyStateProps) {
  return (
    <Card padding={32} className="text-center">
      <h2 className="font-display text-2xl">{title}</h2>
      <p className="mx-auto mt-3 max-w-xl text-sm text-ink-400">{body}</p>
      {actionHref && actionLabel && (
        <Link
          href={actionHref}
          className="mt-6 inline-flex bg-neon px-5 py-3 font-mono text-xs font-semibold uppercase tracking-wider text-neon-text hover:bg-neon/90"
        >
          {actionLabel}
        </Link>
      )}
    </Card>
  );
}
