"use client";

import { Say } from "../components/PortalText";

export default function PrintButton() {
  return (
    <button type="button" className="primary-button worksheet-print-button" onClick={() => window.print()}>
      <Say en="Print this worksheet" bn="ওয়ার্কশিটটি প্রিন্ট করুন" />
    </button>
  );
}
