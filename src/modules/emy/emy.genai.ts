// Dynamic ESM loader for @google/genai inside CommonJS backend without altering tsconfig/package.json
const dynamicImport = new Function('specifier', 'return import(specifier)') as (
    specifier: string,
) => Promise<any>;

export async function createGenAIClient(apiVersion?: string): Promise<any | null> {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) return null;
    const mod = await dynamicImport('@google/genai');
    const GoogleGenAI = mod.GoogleGenAI;
    return apiVersion
        ? new GoogleGenAI({ apiKey, httpOptions: { apiVersion } })
        : new GoogleGenAI({ apiKey });
}
