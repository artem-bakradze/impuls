/** Marks a card field the service could not determine; nothing is invented in its place. */
export function Missing({ show }: { show: boolean }) {
  return show ? <span className="missing">Не нашли — заполните</span> : null;
}
