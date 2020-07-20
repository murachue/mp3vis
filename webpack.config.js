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
    devtool: "inline-source-map",
    output: {
        filename: "mp3vis.js",
        path: __dirname,
        // libraryTarget: "umd",
        libraryTarget: "window",
        library: "Mp3vis",
    },
};
