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
