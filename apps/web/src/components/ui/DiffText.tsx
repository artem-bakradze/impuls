/** Words of `text` that `other` does not have, highlighted: how two ad variants differ at a glance. */
export function DiffText({ text, other }: { text: string; other: string }) {
  const theirs = new Set(other.toLowerCase().split(/\s+/));
  return (
    <>
      {text.split(/(\s+)/).map((part, i) =>
        part.trim() !== "" && !theirs.has(part.toLowerCase()) ? (
          <mark key={i} className="diff-mark">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}
