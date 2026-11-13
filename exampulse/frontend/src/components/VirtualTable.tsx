// Virtualized Table for Invigilator Dashboard (High performance 20k rows)
import React, { useRef, useState, useEffect } from 'react';

export interface TableColumn<T> {
  key: string;
  header: string;
  width?: string;
  render?: (item: T) => React.ReactNode;
}

interface VirtualTableProps<T> {
  data: T[];
  columns: TableColumn<T>[];
  rowHeight?: number;
  height?: number;
  onRowClick?: (item: T) => void;
}

export function VirtualTable<T extends { id?: any; candidateId?: any }>({
  data,
  columns,
  rowHeight = 44,
  height = 500,
  onRowClick,
}: VirtualTableProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);

  const totalHeight = data.length * rowHeight;
  const visibleCount = Math.ceil(height / rowHeight) + 4; // buffer
  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - 2);
  const endIndex = Math.min(data.length, startIndex + visibleCount);

  const visibleData = data.slice(startIndex, endIndex);
  const offsetY = startIndex * rowHeight;

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  };

  return (
    <div className="table-container" style={{ height, overflowY: 'auto' }} onScroll={onScroll} ref={containerRef}>
      <table style={{ minWidth: '700px' }}>
        <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
          <tr>
            {columns.map((col) => (
              <th key={col.key} style={{ width: col.width }}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* Spacer for virtual offset */}
          {offsetY > 0 && <tr style={{ height: `${offsetY}px` }}><td colSpan={columns.length} /></tr>}

          {visibleData.map((item, index) => {
            const actualIndex = startIndex + index;
            const rowKey = item.candidateId || item.id || actualIndex;
            return (
              <tr
                key={rowKey}
                style={{ height: `${rowHeight}px`, cursor: onRowClick ? 'pointer' : 'default' }}
                onClick={() => onRowClick && onRowClick(item)}
              >
                {columns.map((col) => (
                  <td key={col.key}>
                    {col.render ? col.render(item) : (item as any)[col.key]}
                  </td>
                ))}
              </tr>
            );
          })}

          {/* Spacer for bottom offset */}
          {totalHeight - (offsetY + visibleData.length * rowHeight) > 0 && (
            <tr style={{ height: `${totalHeight - (offsetY + visibleData.length * rowHeight)}px` }}>
              <td colSpan={columns.length} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
