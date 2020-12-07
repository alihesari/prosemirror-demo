export function undo(state: any): boolean;
export function redo(state: any): boolean;
export function yUndoPlugin({ protectedNodes, trackedOrigins }?: {
    protectedNodes?: Set<string>;
    trackedOrigins?: any[];
}): Plugin<any, any>;
import { Plugin } from "prosemirror-state";
