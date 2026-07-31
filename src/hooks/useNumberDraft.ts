import { useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";

interface NumberDraftOptions {
  value: number;
  min: number;
  max: number;
  step: number;
  onValueChange: (value: number) => void;
  handleArrowKeys?: boolean;
}

export function useNumberDraft({
  value,
  min,
  max,
  step,
  onValueChange,
  handleArrowKeys = false,
}: NumberDraftOptions) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelOnBlurRef = useRef(false);
  const displayedValue = draft ?? String(value);
  const parsedValue = Number(displayedValue);

  function handleFocus() {
    cancelOnBlurRef.current = false;
    setDraft(String(value));
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const nextDraft = event.currentTarget.value;
    const nextValue = Number(nextDraft);
    setDraft(nextDraft);

    if (
      nextDraft.trim() !== "" &&
      Number.isFinite(nextValue) &&
      nextValue >= min &&
      nextValue <= max
    ) {
      onValueChange(nextValue);
    }
  }

  function handleBlur() {
    if (cancelOnBlurRef.current) {
      cancelOnBlurRef.current = false;
      setDraft(null);
      return;
    }

    const nextValue = Number(draft ?? value);
    setDraft(null);

    if (draft?.trim() === "" || !Number.isFinite(nextValue)) {
      return;
    }

    onValueChange(clamp(nextValue, min, max));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (
      handleArrowKeys &&
      (event.key === "ArrowUp" || event.key === "ArrowDown") &&
      Number.isFinite(parsedValue)
    ) {
      event.preventDefault();
      const direction = event.key === "ArrowUp" ? 1 : -1;
      const nextValue = clamp(parsedValue + direction * step, min, max);
      setDraft(String(nextValue));
      onValueChange(nextValue);
      return;
    }

    if (event.key === "Enter") {
      event.currentTarget.blur();
      return;
    }

    if (event.key === "Escape") {
      cancelOnBlurRef.current = true;
      setDraft(null);
      event.currentTarget.blur();
    }
  }

  return {
    displayedValue,
    parsedValue,
    handleFocus,
    handleChange,
    handleBlur,
    handleKeyDown,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
