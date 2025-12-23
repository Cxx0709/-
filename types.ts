import * as THREE from 'three';

export enum AppMode {
    TREE = 'TREE',
    SCATTER = 'SCATTER',
    FOCUS = 'FOCUS',
    SATURN = 'SATURN'
}

export interface ParticleConfig {
    colors: {
        bg: number;
        darkBlue: number;
        purple: number;
        pink: number;
        silver: number;
        lightBlue: number;
        orange: number;
    };
    camera: {
        z: number;
    };
}

export interface HandVector {
    x: number;
    y: number;
    detected: boolean;
}

export interface AppState {
    mode: AppMode;
    status: string;
    isWarn: boolean;
    loading: boolean;
    camActive: boolean;
}