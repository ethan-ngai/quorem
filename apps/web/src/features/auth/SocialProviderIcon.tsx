/** @file SocialProviderIcon.tsx @description Shared social sign-in marks. @module auth */
import type { SocialProvider } from "./capabilities";

const paths: Partial<Record<SocialProvider, string>> = {
  github:
    "M12 .75a11.25 11.25 0 0 0-3.56 21.92c.56.1.77-.24.77-.54v-2.1c-3.14.68-3.8-1.34-3.8-1.34-.52-1.31-1.26-1.66-1.26-1.66-1.03-.7.08-.69.08-.69 1.14.08 1.74 1.17 1.74 1.17 1.01 1.73 2.65 1.23 3.3.94.1-.73.4-1.23.72-1.51-2.5-.29-5.13-1.25-5.13-5.56 0-1.23.44-2.23 1.16-3.02-.12-.29-.5-1.43.11-2.98 0 0 .95-.3 3.1 1.16a10.8 10.8 0 0 1 5.64 0c2.15-1.45 3.1-1.16 3.1-1.16.61 1.55.23 2.7.11 2.98.72.79 1.16 1.79 1.16 3.02 0 4.32-2.64 5.27-5.15 5.55.41.36.77 1.05.77 2.12v3.08c0 .3.2.65.78.54A11.25 11.25 0 0 0 12 .75Z",
};

export function SocialProviderIcon({
  provider,
  size = 16,
  color = false,
}: {
  provider: SocialProvider;
  size?: number;
  color?: boolean;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      {color && provider === "google" ? (
        <>
          <path
            fill="#4285F4"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.19 3.32v2.77h3.56c2.08-1.92 3.27-4.74 3.27-8.1Z"
          />
          <path
            fill="#34A853"
            d="M12 23c2.97 0 5.46-.98 7.29-2.65l-3.56-2.77c-.98.66-2.23 1.06-3.73 1.06-2.87 0-5.3-1.94-6.17-4.54H2.15v2.84A11 11 0 0 0 12 23Z"
          />
          <path
            fill="#FBBC05"
            d="M5.83 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.15a11 11 0 0 0 0 9.88l3.68-2.84Z"
          />
          <path
            fill="#EA4335"
            d="M12 5.36c1.62 0 3.06.56 4.21 1.64l3.16-3.16A10.58 10.58 0 0 0 12 1a11 11 0 0 0-9.85 6.06L5.83 9.9C6.7 7.3 9.13 5.36 12 5.36Z"
          />
        </>
      ) : provider === "google" ? (
        <path d="M21.8 12.2c0-.7-.06-1.4-.19-2.1H12v4h5.5a4.7 4.7 0 0 1-2 3.1 6 6 0 1 1-.2-10.1l3-3A10.2 10.2 0 1 0 12 22.2c5.7 0 9.8-4 9.8-10Z" />
      ) : (
        <path d={paths.github} />
      )}
    </svg>
  );
}
