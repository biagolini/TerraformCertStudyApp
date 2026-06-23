export interface PackDomain {
  name: string;
  description: string;
  order?: number;
}

export interface Pack {
  id: string;
  name: string;
  description: string;
  version: string;
  domains: PackDomain[];
  color: string;
  createdAt: number;
  updatedAt: number;
}

export interface PackColorOption {
  id: string;
  name: string;
  value: string;
}

export const PACK_COLORS: PackColorOption[] = [
  { id: 'purple', name: 'Purple', value: '#6c5ce7' },
  { id: 'blue', name: 'Blue', value: '#0984e3' },
  { id: 'sky', name: 'Sky', value: '#74b9ff' },
  { id: 'cyan', name: 'Cyan', value: '#00cec9' },
  { id: 'green', name: 'Green', value: '#00b894' },
  { id: 'yellow', name: 'Yellow', value: '#fdcb6e' },
  { id: 'amber', name: 'Amber', value: '#e17055' },
  { id: 'red', name: 'Red', value: '#d63031' },
  { id: 'pink', name: 'Pink', value: '#e84393' },
  { id: 'lavender', name: 'Lavender', value: '#a29bfe' },
  { id: 'slate', name: 'Slate', value: '#7f8c9c' },
];

export const DEFAULT_PACK_COLOR = PACK_COLORS[0].value;

export const DEFAULT_PACK_NAME = 'My first exam';

export const MAX_PACK_DOMAINS = 20;

export function isValidPackColor(value: string): boolean {
  return PACK_COLORS.some((c) => c.value === value);
}

export function isValidHexColor(value: string): boolean {
  return /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(value);
}

export function isAcceptablePackColor(value: string): boolean {
  return isValidPackColor(value) || isValidHexColor(value);
}

export function packDisplayLabel(pack: Pack): string {
  return pack.version ? `${pack.name} · ${pack.version}` : pack.name;
}
