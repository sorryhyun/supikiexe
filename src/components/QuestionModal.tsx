import { useState, useEffect, useCallback } from "react";
import type { AgentQuestion } from "../services/agentTypes";
import { useModalWindow } from "../hooks/useModalWindow";
import "../styles/questionmodal.css";

interface QuestionModalProps {
  questionId: string;
  questions: AgentQuestion[];
  onSubmit: (answers: Record<string, string>) => void;
  onCancel?: () => void;
}

function QuestionModal({
  questionId: _questionId,
  questions,
  onSubmit,
  onCancel,
}: QuestionModalProps) {
  // Track current question index for navigation
  const [currentIndex, setCurrentIndex] = useState(0);
  // Track selected answers for each question
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  // Track "Other" text input for each question
  const [otherText, setOtherText] = useState<Record<string, string>>({});
  // Track which questions have "Other" selected
  const [otherSelected, setOtherSelected] = useState<Record<string, boolean>>(
    {}
  );

  // Current question and navigation state
  const currentQuestion = questions[currentIndex];
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === questions.length - 1;
  const hasMultipleQuestions = questions.length > 1;

  // Check if all questions have answers
  const allAnswered = questions.every((q) => {
    const selected = answers[q.question] || [];
    const hasOther = otherSelected[q.question] && otherText[q.question]?.trim();
    return selected.length > 0 || hasOther;
  });

  // Handle option selection
  const handleSelect = (question: AgentQuestion, optionLabel: string) => {
    setAnswers((prev) => {
      const current = prev[question.question] || [];

      if (question.multiSelect) {
        // Toggle for multi-select
        if (current.includes(optionLabel)) {
          return {
            ...prev,
            [question.question]: current.filter((l) => l !== optionLabel),
          };
        } else {
          return {
            ...prev,
            [question.question]: [...current, optionLabel],
          };
        }
      } else {
        // Single-select: replace
        // Clear "Other" when selecting a regular option
        setOtherSelected((prev) => ({ ...prev, [question.question]: false }));
        setOtherText((prev) => ({ ...prev, [question.question]: "" }));
        return {
          ...prev,
          [question.question]: [optionLabel],
        };
      }
    });
  };

  // Handle "Other" toggle
  const handleOtherToggle = (question: AgentQuestion) => {
    if (!question.multiSelect) {
      // For single-select, clear regular selections when choosing Other
      setAnswers((prev) => ({ ...prev, [question.question]: [] }));
    }
    setOtherSelected((prev) => ({
      ...prev,
      [question.question]: !prev[question.question],
    }));
  };

  // Handle submit
  const handleSubmit = useCallback(() => {
    const formattedAnswers: Record<string, string> = {};

    for (const question of questions) {
      const selected = answers[question.question] || [];
      const hasOther =
        otherSelected[question.question] && otherText[question.question]?.trim();

      const allSelected = hasOther
        ? [...selected, otherText[question.question].trim()]
        : selected;

      // Multi-select answers are comma-separated
      formattedAnswers[question.question] = allSelected.join(", ");
    }

    onSubmit(formattedAnswers);
  }, [questions, answers, otherSelected, otherText, onSubmit]);

  // Navigation handlers
  const goToPrev = useCallback(() => {
    if (!isFirst) setCurrentIndex((i) => i - 1);
  }, [isFirst]);

  const goToNext = useCallback(() => {
    if (!isLast) setCurrentIndex((i) => i + 1);
  }, [isLast]);

  // Use modal window hook for escape key
  useModalWindow({ onEscape: onCancel });

  // Additional keyboard handling (Enter, Arrow keys)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter" && allAnswered && !e.shiftKey) {
        handleSubmit();
      } else if (e.key === "ArrowLeft" && hasMultipleQuestions) {
        goToPrev();
      } else if (e.key === "ArrowRight" && hasMultipleQuestions) {
        goToNext();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [allAnswered, handleSubmit, hasMultipleQuestions, goToPrev, goToNext]);

  return (
    <div className="modal-overlay question-modal-overlay">
      <div className="modal question-modal">
        <div className="modal-header question-modal-header">
          <span>Question from Clawd</span>
          {onCancel && (
            <button className="modal-close" onClick={onCancel}>
              x
            </button>
          )}
        </div>

        <div className="modal-body">
          <div className="question-item">
            <div className="question-header-tag">{currentQuestion.header}</div>
            <div className="question-text">{currentQuestion.question}</div>

            <div className="question-options">
              {currentQuestion.options.map((option, optIndex) => {
                const isSelected = (
                  answers[currentQuestion.question] || []
                ).includes(option.label);

                return (
                  <button
                    key={optIndex}
                    className={`question-option ${isSelected ? "selected" : ""}`}
                    onClick={() => handleSelect(currentQuestion, option.label)}
                  >
                    <span className="option-indicator">
                      {currentQuestion.multiSelect ? (
                        isSelected ? "✓" : "○"
                      ) : isSelected ? (
                        "●"
                      ) : (
                        "○"
                      )}
                    </span>
                    <div className="option-content">
                      <div className="option-label">{option.label}</div>
                      {option.description && (
                        <div className="option-description">
                          {option.description}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}

              {/* "Other" option */}
              <button
                className={`question-option other-option ${otherSelected[currentQuestion.question] ? "selected" : ""}`}
                onClick={() => handleOtherToggle(currentQuestion)}
              >
                <span className="option-indicator">
                  {currentQuestion.multiSelect ? (
                    otherSelected[currentQuestion.question] ? "✓" : "○"
                  ) : otherSelected[currentQuestion.question] ? (
                    "●"
                  ) : (
                    "○"
                  )}
                </span>
                <div className="option-content">
                  <div className="option-label">Other</div>
                </div>
              </button>

              {otherSelected[currentQuestion.question] && (
                <input
                  type="text"
                  className="other-input"
                  placeholder="Enter your answer..."
                  value={otherText[currentQuestion.question] || ""}
                  onChange={(e) =>
                    setOtherText((prev) => ({
                      ...prev,
                      [currentQuestion.question]: e.target.value,
                    }))
                  }
                  autoFocus
                />
              )}
            </div>
          </div>
        </div>

        <div className="modal-footer question-modal-footer">
          {hasMultipleQuestions && (
            <div className="question-nav-buttons">
              <button
                className="question-nav-btn"
                onClick={goToPrev}
                disabled={isFirst}
              >
                Prev
              </button>
              <span className="question-indicator">
                {currentIndex + 1} / {questions.length}
              </span>
              <button
                className="question-nav-btn"
                onClick={goToNext}
                disabled={isLast}
              >
                Next
              </button>
            </div>
          )}
          <button
            className="question-submit-btn"
            onClick={handleSubmit}
            disabled={!allAnswered}
          >
            Submit
          </button>
        </div>
      </div>
    </div>
  );
}

export default QuestionModal;
