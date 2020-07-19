module.exports = {
    mode: "development",
    entry: "./mp3vis.ts",
    module: {
        rules: [
            {
                test: /\.ts$/,
                use: "ts-loader",
            },
        ],
    },
    resolve: {
        extensions: [
            ".ts",
        ],
    },
    // optimization: {
    //     usedExports: true,
    // },
    output: {
        filename: "mp3vis.js",
        path: __dirname,
    },
};
