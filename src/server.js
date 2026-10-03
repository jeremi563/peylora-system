import dotenv from "dotenv";

dotenv.config();

const [{ default: app }, { validateEnvironment }, database, security] = await Promise.all([
    import("./app.js"),
    import("./config/environment.js"),
    import("./database.js"),
    import("./middleware/security.js")
]);

const port = process.env.PORT || 5000;

async function startServer() {
    validateEnvironment();
    if (process.env.TRUST_PROXY_HOPS) {
        app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS));
    }
    await security.connectRateLimitStore();
    await database.connectDatabase();
    const server = app.listen(port, () => {
        console.log(`The server is listening on port ${port}`);
    });

    for (const signal of ["SIGINT", "SIGTERM"]) {
        process.once(signal, () => {
            server.close(async () => {
                await Promise.all([database.closeDatabase(), security.closeRateLimitStore()]);
            });
        });
    }
}

startServer().catch((error) => {
    console.error("Could not start server:", error.message);
    Promise.all([database.closeDatabase(), security.closeRateLimitStore()]).catch(() => {});
    process.exitCode = 1;
});