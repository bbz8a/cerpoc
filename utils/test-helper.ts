export function debug(message: string, data?: unknown): void {
    console.log(
        `[${new Date().toISOString()}] ${message}: `,
        data ?? ''
    );
}