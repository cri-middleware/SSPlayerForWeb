export type ThemeChoice = 'auto' | 'light' | 'dark';

export function parseThemeChoice(stored: string | null): ThemeChoice {
    return stored === 'light' || stored === 'dark' ? stored : 'auto';
}

export function nextThemeChoice(choice: ThemeChoice): ThemeChoice {
    switch (choice) {
        case 'auto': return 'light';
        case 'light': return 'dark';
        case 'dark': return 'auto';
    }
}

export function resolveTheme(choice: ThemeChoice, systemPrefersLight: boolean): 'light' | 'dark' {
    if (choice === 'auto') return systemPrefersLight ? 'light' : 'dark';
    return choice;
}

export type RunTone = 'success' | 'warning' | 'error';

export interface ResultText {
    headline: string;
    output: string | null;
    issues: { label?: string; detail: string; tone: 'warning' | 'error' }[];
}

export function resultText(view: ResultText, versions: string | null): string {
    const lines = [view.headline];
    if (view.output) lines.push(view.output);
    for (const issue of view.issues) {
        const prefix = issue.tone === 'error' ? 'Error' : 'Warning';
        lines.push(issue.label ? `${prefix}: ${issue.label}: ${issue.detail}` : `${prefix}: ${issue.detail}`);
    }
    if (versions) lines.push(versions);
    return lines.join('\n');
}
