import type { ObjectChange } from './execution.ts';
export interface TextChange { kind: 'equal' | 'remove' | 'add'; text: string; }
export interface ChangedTextField { field: string; before: string; after: string; lines: TextChange[]; }
export interface CardChangeView {
  operation: ObjectChange;
  state: 'available' | 'unavailable';
  fields: ChangedTextField[];
  metadata: string[];
  hiddenBackChanged: boolean;
  unavailableReason: string | null;
}
