import { DEFAULT_COLUMN_WIDTHS, normalizeColumnWidths, type LocalState } from '../lib/types';

export const DEFAULT_STATE: LocalState = {
    resources: [],
    allocations: {},
    collapsed: {},
    taskOrder: {},
    milestoneOrder: [],
    markers: {},
    hiddenTasks: {},
    hiddenFolderCollapsed: true,
    localMarkers: [],
    draftTasks: [],
    pendingQaDeletes: [],
    projectStart: new Date().toISOString().slice(0, 10),
    showHolidays: true,
    showDeps: false,
    customNonWorkingDays: [],
    dayWidthPx: 28,
    leftPanelWidth: 680,
    columnWidths: { ...DEFAULT_COLUMN_WIDTHS },
    resourcesDockHeight: 220,
    resourcesDockCollapsed: false,
    jql: '',
    savedJqls: [],
    activeSavedJqlId: null,
    milestoneColors: {},
    theme: 'light',
};

function normalizeSavedJqls(raw: Partial<LocalState> | null | undefined): LocalState['savedJqls'] {
    const list = raw?.savedJqls;
    if (!Array.isArray(list)) return [];
    return list
        .filter(
            (item): item is { id: string; name: string; jql: string } =>
                !!item &&
                typeof item.id === 'string' &&
                typeof item.name === 'string' &&
                typeof item.jql === 'string',
        )
        .map((item) => ({
            id: item.id,
            name: item.name.trim() || 'Untitled',
            jql: item.jql,
        }));
}

export function normalizeState(raw: Partial<LocalState> | null | undefined): LocalState {
    const savedJqls = normalizeSavedJqls(raw);
    const activeId =
        typeof raw?.activeSavedJqlId === 'string' &&
        savedJqls.some((s) => s.id === raw.activeSavedJqlId)
            ? raw.activeSavedJqlId
            : null;
    return {
        ...DEFAULT_STATE,
        ...(raw || {}),
        resources: raw?.resources ?? [],
        allocations: raw?.allocations ?? {},
        collapsed: raw?.collapsed ?? {},
        taskOrder: raw?.taskOrder ?? {},
        milestoneOrder: raw?.milestoneOrder ?? [],
        markers: raw?.markers ?? {},
        hiddenTasks: raw?.hiddenTasks ?? {},
        hiddenFolderCollapsed: raw?.hiddenFolderCollapsed !== false,
        localMarkers: raw?.localMarkers ?? [],
        draftTasks: raw?.draftTasks ?? [],
        pendingQaDeletes: raw?.pendingQaDeletes ?? [],
        milestoneColors: raw?.milestoneColors ?? {},
        jql: raw?.jql ?? '',
        savedJqls,
        activeSavedJqlId: activeId,
        projectStart: raw?.projectStart || DEFAULT_STATE.projectStart,
        showHolidays: raw?.showHolidays !== false,
        showDeps: raw?.showDeps === true,
        customNonWorkingDays: raw?.customNonWorkingDays ?? [],
        dayWidthPx: raw?.dayWidthPx || 28,
        leftPanelWidth: raw?.leftPanelWidth || 680,
        columnWidths: normalizeColumnWidths(raw?.columnWidths),
        resourcesDockHeight: raw?.resourcesDockHeight || 220,
        resourcesDockCollapsed: raw?.resourcesDockCollapsed === true,
        theme: raw?.theme === 'dark' ? 'dark' : 'light',
    };
}
