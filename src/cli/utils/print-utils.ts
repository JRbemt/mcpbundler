export const HELP_FOOTER = "\nFor more information and updates checkout: https://github.com/JRbemt/mcpbundler\n";

export const BG_COLORS = {
  BLACK: "\x1b[40m",
  RED: "\x1b[41m",
  GREEN: "\x1b[42m",
  YELLOW: "\x1b[43m",
  BLUE: "\x1b[44m",
  MAGENTA: "\x1b[45m",
  CYAN: "\x1b[46m",
  WHITE: "\x1b[47m",

  BRIGHT_BLACK: "\x1b[100m",
  BRIGHT_RED: "\x1b[101m",
  BRIGHT_GREEN: "\x1b[102m",
  BRIGHT_YELLOW: "\x1b[103m",
  BRIGHT_BLUE: "\x1b[104m",
  BRIGHT_MAGENTA: "\x1b[105m",
  BRIGHT_CYAN: "\x1b[106m",
  BRIGHT_WHITE: "\x1b[107m",
} as const;

export const FG_COLORS = {
  BLACK: "\x1b[30m",
  RED: "\x1b[31m",
  GREEN: "\x1b[32m",
  YELLOW: "\x1b[33m",
  BLUE: "\x1b[34m",
  MAGENTA: "\x1b[35m",
  CYAN: "\x1b[36m",
  WHITE: "\x1b[37m",

  BRIGHT_BLACK: "\x1b[90m",
  BRIGHT_RED: "\x1b[91m",
  BRIGHT_GREEN: "\x1b[92m",
  BRIGHT_YELLOW: "\x1b[93m",
  BRIGHT_BLUE: "\x1b[94m",
  BRIGHT_MAGENTA: "\x1b[95m",
  BRIGHT_CYAN: "\x1b[96m",
  BRIGHT_WHITE: "\x1b[97m",
} as const;


/**
 * Wraps text at specified width, normalizing whitespace and newlines.
 * Returns an array of lines that fit within the specified width.
 */
export function wrapText(text: string, width: number): string[] {
  if (!text) return ["-"];
  const normalizedText = text.replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
  const words = normalizedText.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const testLine = currentLine ? currentLine + " " + word : word;
    if (testLine.length <= width) {
      currentLine = testLine;
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) lines.push(currentLine);

  return lines;
}

export interface TableColumn {
  header: string;
  width: number;
  key: string;
}

export interface PrintTableOptions {
  columns: TableColumn[];
  color?: string;
  maxRows?: number;
  indent?: string;
}

/**
 * Prints a formatted table with word-wrapped content.
 * Supports multi-line cells and configurable column widths.
 */
export function printTable<T extends Record<string, string | undefined>>(
  data: T[],
  options: PrintTableOptions
): void {
  const { columns, maxRows, indent = "   " } = options;
  const color = options.color ?? FG_COLORS.GREEN;
  const reset = "\x1b[0m";

  const rowsToShow = maxRows ? data.slice(0, maxRows) : data;

  // Build border strings
  const topBorder = `${indent}┌─${columns.map(c => "─".repeat(c.width)).join("─┬─")}─┐`;
  const headerSeparator = `${indent}├─${columns.map(c => "─".repeat(c.width)).join("─┼─")}─┤`;
  const rowSeparator = headerSeparator;
  const bottomBorder = `${indent}└─${columns.map(c => "─".repeat(c.width)).join("─┴─")}─┘`;

  // Print header
  console.group();
  console.log(topBorder);
  const headerRow = columns.map(c => `${color}${c.header.padEnd(c.width)}${reset}`).join(" │ ");
  console.log(`${indent}│ ${headerRow} │`);
  console.log(headerSeparator);

  // Print data rows
  rowsToShow.forEach((row, index) => {
    const wrappedColumns = columns.map(c => wrapText(row[c.key] || "-", c.width));
    const maxLines = Math.max(...wrappedColumns.map(w => w.length));

    for (let i = 0; i < maxLines; i++) {
      const lineParts = columns.map((c, colIndex) => {
        const part = wrappedColumns[colIndex][i] || "";
        return `${color}${part.padEnd(c.width)}${reset}`;
      });
      console.log(`${indent}│ ${lineParts.join(" │ ")} │`);
    }

    if (index < rowsToShow.length - 1) {
      console.log(rowSeparator);
    }
  });

  // Print "more" row if truncated
  if (maxRows && data.length > maxRows) {
    console.log(rowSeparator);
    const moreText = `... ${data.length - maxRows} more item(s) not shown ...`;
    const firstCol = `${color}${"...".padEnd(columns[0].width)}${reset}`;
    const restCols = columns.slice(1).map((c, i) => {
      const text = i === 0 ? moreText : "";
      return `${color}${text.padEnd(c.width)}${reset}`;
    });
    console.log(`${indent}│ ${[firstCol, ...restCols].join(" │ ")} │`);
  }

  console.log(bottomBorder);
  console.groupEnd();
}

export function banner(
  text: string,
  options?: {
    bg?: (typeof BG_COLORS)[keyof typeof BG_COLORS];
    fg?: (typeof FG_COLORS)[keyof typeof FG_COLORS];
  }
) {
  const bg = options?.bg ?? "";
  const fg = options?.fg ?? "";

  console.log(`${bg}${fg}${text}\x1b[0m`);
}
