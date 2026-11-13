// Accessible Question Palette Component
import React from 'react';

export interface QuestionStatus {
  id: number;
  number: number;
  isAnswered: boolean;
  isMarked: boolean;
}

interface QuestionPaletteProps {
  questions: QuestionStatus[];
  currentIndex: number;
  onSelect: (index: number) => void;
}

export const QuestionPalette: React.FC<QuestionPaletteProps> = ({ questions, currentIndex, onSelect }) => {
  return (
    <nav aria-label="Question Navigator" style={{ marginTop: '16px' }}>
      <h3 style={{ fontSize: '1rem', marginBottom: '8px' }}>Questions Overview</h3>

      {/* Accessible Legend */}
      <div className="palette-legend" role="region" aria-label="Question status legend">
        <div className="legend-item">
          <div className="legend-chip palette-not-visited">1</div>
          <span>Unanswered (Solid outline)</span>
        </div>
        <div className="legend-item">
          <div className="legend-chip palette-answered">✓</div>
          <span>Answered (Checkmark + green)</span>
        </div>
        <div className="legend-item">
          <div className="legend-chip palette-marked">⚑</div>
          <span>Marked for Review (Dashed + Flag)</span>
        </div>
      </div>

      {/* Grid of question buttons */}
      <div className="palette-grid" role="group" aria-label="Jump to question">
        {questions.map((q, idx) => {
          let stateClass = 'palette-not-visited';
          let stateLabel = 'Unanswered';

          if (q.isMarked) {
            stateClass = 'palette-marked';
            stateLabel = 'Marked for review';
          } else if (q.isAnswered) {
            stateClass = 'palette-answered';
            stateLabel = 'Answered';
          }

          const isActive = idx === currentIndex;

          return (
            <button
              key={q.id}
              type="button"
              className={`palette-item ${stateClass} ${isActive ? 'active' : ''}`}
              onClick={() => onSelect(idx)}
              aria-label={`Question ${q.number}: ${stateLabel}${isActive ? ', currently selected' : ''}`}
              aria-current={isActive ? 'step' : undefined}
            >
              <span style={{ fontSize: '1.1rem' }}>{q.number}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
