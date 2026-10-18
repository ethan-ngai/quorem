import "./username-rules.css";
export function UsernameRules({ id }: { id: string }) {
  return (
    <ul className="username-rules" id={id}>
      <li>3–30 characters.</li>
      <li>Lowercase letters (a–z) and numbers (0–9).</li>
      <li>No spaces or special characters.</li>
    </ul>
  );
}
