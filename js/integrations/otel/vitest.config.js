import { defineConfig } from 'vitest/config';

export default defineConfig({
    server: {
        deps: {
            ssr: { include: ['braintrust'] },
            fallbackCJS: true,
        },
    }
});

