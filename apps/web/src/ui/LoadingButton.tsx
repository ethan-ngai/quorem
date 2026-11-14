import type { ComponentProps, ReactNode } from "react";
import { RotateCw } from "lucide-react";
import { Spinner } from "./Spinner";
import { StateIcon } from "./StateIcon";
import { useLoadingVisibility } from "./LoadingState";

export function LoadingIcon({
  pending,
  icon,
  size = 16,
}: {
  pending: boolean;
  icon?: ReactNode;
  size?: number;
}) {
  const visible = useLoadingVisibility(pending);
  return <StateIcon active={visible} off={icon} on={<Spinner size={size} active={visible} />} />;
}

/** Keep the icon slot mounted while guarding native and focus-preserving buttons. */
export function LoadingButton({
  pending,
  icon,
  iconSize = 16,
  iconClassName,
  disabled,
  "aria-disabled": ariaDisabled,
  onClick,
  children,
  ...props
}: ComponentProps<"button"> & {
  pending: boolean;
  icon?: ReactNode;
  iconSize?: number;
  iconClassName?: string;
}) {
  const indicator = (
    <LoadingIcon pending={pending} size={iconSize} icon={icon ?? <RotateCw size={iconSize} />} />
  );
  return (
    <button
      {...props}
      disabled={disabled || (pending && ariaDisabled === undefined)}
      aria-disabled={pending && ariaDisabled !== undefined ? true : ariaDisabled}
      aria-busy={pending}
      onClick={(event) => {
        if (pending || ariaDisabled === true || ariaDisabled === "true") {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
    >
      {iconClassName ? <span className={iconClassName}>{indicator}</span> : indicator}
      {children}
    </button>
  );
}
