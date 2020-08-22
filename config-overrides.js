// https://medium.com/@hokan_dev/react%E3%81%A7hmr%E3%81%99%E3%82%8B%E6%96%B9%E6%B3%95-aa3d851ce1b5

const rewireReactHotLoader = require("react-app-rewire-hot-loader");

module.exports = function override(config, env) {
    config = rewireReactHotLoader(config, env);
    return config;
};
