export interface SelectOption { value: string; label: string; disabled?: boolean }
export interface SelectOptionGroup { label: string; items: SelectEntry[] }
export type SelectEntry = SelectOption | SelectOptionGroup;
export const isSelectGroup = (entry: SelectEntry): entry is SelectOptionGroup => 'items' in entry;
export const flattenOptions = (entries: SelectEntry[]): SelectOption[] => entries.flatMap(entry => isSelectGroup(entry) ? flattenOptions(entry.items) : [entry]);
