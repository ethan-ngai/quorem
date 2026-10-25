/** Shared clipboard feedback, native-share state and transient failure handling. */
import { useEffect, useRef, useState } from "react";
import { useErrorNotification } from "./Notifications";
import { shareLink, type ShareLinkData } from "./shareLink";

export function useShareLink() {
  const [copied, setCopied] = useState<string>();
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string>();
  const expiry = useRef<ReturnType<typeof setTimeout>>(undefined);
  const busy = useRef(false);
  useErrorNotification(error);
  useEffect(() => () => clearTimeout(expiry.current), []);

  function markCopied(url: string) {
    clearTimeout(expiry.current);
    setCopied(url);
    expiry.current = setTimeout(() => setCopied(undefined), 2000);
  }
  async function copy(data: ShareLinkData) {
    setError(undefined);
    try {
      await navigator.clipboard.writeText(data.url);
      markCopied(data.url);
    } catch {
      setError("Copy unavailable. Select and copy the link.");
    }
  }
  async function share(data: ShareLinkData) {
    if (busy.current) return;
    busy.current = true;
    setSharing(true);
    setError(undefined);
    try {
      if ((await shareLink(data)) === "copied") markCopied(data.url);
    } catch {
      setError("Sharing unavailable. Copy the invitation link instead.");
    } finally {
      busy.current = false;
      setSharing(false);
    }
  }
  return { copied, sharing, copy, share };
}
