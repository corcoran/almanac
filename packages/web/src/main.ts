import { createPinia } from "pinia";
import { createApp } from "vue";
import App from "./App.vue";
import "./styles/base.css";

// Surface the built commit so you can confirm which bundle is served: logged
// on boot and written to <meta name="commit"> for scripted inspection.
console.info(`almanac web — commit ${__COMMIT__}`);
const commitMeta = document.createElement("meta");
commitMeta.name = "commit";
commitMeta.content = __COMMIT__;
document.head.appendChild(commitMeta);

const app = createApp(App);
app.use(createPinia());
app.mount("#app");
