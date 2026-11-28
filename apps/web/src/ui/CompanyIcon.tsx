/** @file CompanyIcon.tsx @description Shared local company marks and theme variants. @module ui */
import "./company-icon.css";

const logos = import.meta.glob<string>("../assets/company-logos/*.{png,svg}", {
  eager: true,
  import: "default",
  query: "?url&no-inline",
});
/** Return approved local artwork when available. The surrounding control names the company. */
export function companyIcon(company: string) {
  const key = company.trim().toLowerCase().replace(/\s+/gu, "-");
  const file = `../assets/company-logos/${key}`;
  const mask = logos[`${file}.mask.png`];
  if (mask)
    return (
      <span
        className="company-icon company-icon-mask"
        aria-hidden="true"
        style={{ maskImage: `url("${mask}")` }}
      />
    );

  const logo = logos[`${file}.png`] ?? logos[`${file}.svg`];
  const dark = logos[`${file}.dark.svg`];
  if (!logo) return undefined;
  return (
    <span className="company-icon" aria-hidden="true">
      <img
        className={dark ? "company-icon-light" : undefined}
        src={logo}
        alt=""
        draggable={false}
        loading="lazy"
      />
      {dark && (
        <img className="company-icon-dark" src={dark} alt="" draggable={false} loading="lazy" />
      )}
    </span>
  );
}
