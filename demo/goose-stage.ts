// Exposes the real goose (same model + animation code as the extension) to the demo recorder.
import { createStage, Goose } from "../src/goose";
(window as any).GooseStage = { createStage, Goose };
