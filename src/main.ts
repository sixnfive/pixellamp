import { App } from './App';

const container = document.getElementById('app') as HTMLDivElement;
const app = new App(container);
app.start();

// Hot reload safety
if (import.meta.hot) {
  import.meta.hot.dispose(() => app.dispose());
}
