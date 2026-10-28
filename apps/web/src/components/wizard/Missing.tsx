import { Tag } from "antd";

/** Marks a card field the service could not determine; nothing is invented in its place. */
export function Missing({ show }: { show: boolean }) {
  return show ? (
    <Tag color="orange" style={{ marginLeft: 8 }}>
      Не нашли — заполните
    </Tag>
  ) : null;
}
