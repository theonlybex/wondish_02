"use client";

interface Props {
  /** Clara's question — already shown as the end of her message; used as the group's label. */
  question: string;
  options: string[];
  /** True while a reply streams: a tap now would send a second message. */
  disabled: boolean;
  onPick: (option: string) => void;
  /** "Other…" — the member types their own answer instead. */
  onOther: () => void;
}

/**
 * Tappable answer boxes under Clara's latest message. The parent removes them
 * on the first tap (Review Focus 1), so a double tap can only ever send once.
 */
export default function AnswerChoices({ question, options, disabled, onPick, onOther }: Props) {
  const base =
    "min-h-[44px] px-4 py-2 rounded-xl text-sm font-medium text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer";
  return (
    <div role="group" aria-label={question} className="flex flex-wrap gap-2 pl-[38px]">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          disabled={disabled}
          onClick={() => onPick(option)}
          className={`${base} bg-white hover:bg-primary/[0.06]`}
          style={{ color: "#812549", border: "1px solid rgba(129,37,73,0.3)" }}
        >
          {option}
        </button>
      ))}
      <button
        type="button"
        disabled={disabled}
        onClick={onOther}
        className={`${base} bg-transparent hover:bg-[#F9F7ED]`}
        style={{ color: "#848181", border: "1px dashed rgba(30,26,26,0.18)" }}
      >
        Other…
      </button>
    </div>
  );
}
