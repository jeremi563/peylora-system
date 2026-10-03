export function validateRequest(schema) {
    return (req, res, next) => {
        const result = schema.safeParse(req.body);
        if (!result.success) {
            return res.status(400).json({
                success: false,
                message: "Request validation failed",
                errors: result.error.issues.map(({ path, message }) => ({
                    field: path.join("."),
                    message
                }))
            });
        }

        req.validatedBody = result.data;
        return next();
    };
}

export function validateQuery(schema) {
    return (req, res, next) => {
        const result = schema.safeParse(req.query);
        if (!result.success) {
            return res.status(400).json({
                success: false,
                message: "Query validation failed",
                errors: result.error.issues.map(({ path, message }) => ({
                    field: path.join("."),
                    message
                }))
            });
        }

        req.validatedQuery = result.data;
        return next();
    };
}

export function validateParam(schema, parameterName) {
    return (req, res, next) => {
        const result = schema.safeParse(req.params[parameterName]);
        if (!result.success) {
            return res.status(400).json({
                success: false,
                message: "Path parameter is invalid",
                errors: result.error.issues.map(({ message }) => ({
                    field: parameterName,
                    message
                }))
            });
        }

        req.params[parameterName] = result.data;
        return next();
    };
}