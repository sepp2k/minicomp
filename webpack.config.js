const path = require('path');
module.exports = {
    "mode": "development",
    "entry": "./src/main/web/index.js",
    "output": {
        "path": path.resolve(__dirname, "target/web/"),
        "filename": "minicomp.bundle.js"
    },
    devtool: 'source-map',
    node: {
        module: "empty",
        net:"empty",
        fs: "empty"
    },
    module: {
        rules: [
            {
                test: /\.(?:png|gif|jpe?g|svg)$/,
                use: "url-loader"
            },
            {
                test: /\.css$/,
                use: [
                    { loader: "style-loader" },
                    { loader: "css-loader" }
                ]
            },
            {
                test: /\.html?$/,
                loader: 'file-loader',
                options: {
                    name: '[name].[ext]'
                }
            }
        ]
    }
};