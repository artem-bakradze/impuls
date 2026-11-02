/**
 * Marks a card field the service could not determine; nothing is invented in its place. Optional fields get a softer
 * note: the owner may leave them empty.
 */
export function Missing({ show, optional = false }: { show: boolean; optional?: boolean }) {
  if (!show) return null;
  return <span className={optional ? "missing missing-optional" : "missing"}>{optional ? "Не нашли — можно дописать" : "Не нашли — заполните"}</span>;
}
