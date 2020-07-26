module.exports = {
    // mode: "development",
    // optimization: {
    //     usedExports: true,
    //     concatenateModules: true,
    //     providedExports: true,
    // },
    mode: "production",
    optimization: {
        minimize: false,
    },
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
    devtool: "inline-source-map",
    output: {
        filename: "mp3vis.js",
        path: __dirname,
        // libraryTarget: "umd",
        libraryTarget: "window",
        library: "Mp3vis",
    },
};
