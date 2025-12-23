import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass';
import { FilesetResolver, HandLandmarker, HandLandmarkerResult } from '@mediapipe/tasks-vision';
import { AppMode, ParticleConfig, HandVector } from './types';

// --- Configuration ---
// UPDATED: Dreamy Palette - Reduced Warm tones, emphasized Light Blue & Pink
const CONFIG: ParticleConfig = {
    colors: {
        bg: 0x020205,       
        darkBlue: 0x0f1746, 
        purple: 0x8a4fff,   
        pink: 0xffaacc,     
        silver: 0xffffff,   
        lightBlue: 0xa6e3e9,
        orange: 0xff8800    
    },
    camera: { z: 50 } 
};

// --- Helper Classes ---
class InstancedParticle {
    mesh: THREE.InstancedMesh;
    id: number;
    type: string;
    posT: THREE.Vector3; // Target Position (Tree)
    posS: THREE.Vector3; // Target Position (Scatter)
    posSat: THREE.Vector3; // Target Position (Saturn)
    cur: THREE.Vector3;  // Current Position
    s: number;           // Scale
    bs: number;          // Base Scale
    rot: THREE.Euler;
    mat: THREE.Matrix4;

    constructor(mesh: THREE.InstancedMesh, id: number, type: string) {
        this.mesh = mesh;
        this.id = id;
        this.type = type;
        this.posT = new THREE.Vector3();
        this.posS = new THREE.Vector3();
        this.posSat = new THREE.Vector3();
        this.cur = new THREE.Vector3();
        this.s = 1;
        
        // Base size randomization
        this.bs = 0.05 + Math.random() * 0.25; 
        
        this.rot = new THREE.Euler(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
        this.mat = new THREE.Matrix4();
        this.calc();
        this.updM();
    }

    calc() {
        // --- 1. TREE CALCULATION ---
        const h = 30; 
        const maxR = 12;

        // Galaxy Topper (The Star)
        if (Math.random() < 0.03) {
            const r = Math.random() * 2.5; 
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            this.posT.set(
                r * Math.sin(phi) * Math.cos(theta),
                (h / 2 + 1.5) + r * Math.sin(phi) * Math.sin(theta), 
                r * Math.cos(phi)
            );
            this.bs *= 1.5; 
        } else {
            const t = Math.random(); 
            const y = t * h - h / 2;
            const coneR = maxR * (1 - Math.pow(t, 0.85));
            let ribbonProb = 0.35; 
            if (this.type === 'orange') ribbonProb = 0.5;
            
            const isRibbon = Math.random() < ribbonProb;
            let finalR, finalTheta, finalY;

            if (isRibbon) {
                this.bs *= 1.8; 
                const loops = 6; 
                const spiralTheta = t * Math.PI * 2 * loops;
                const ribbonWidth = 3.5 * (1 - t * 0.4); 
                const rOffset = (Math.random() - 0.5) * ribbonWidth; 
                const yOffset = (Math.random() - 0.5) * (ribbonWidth * 0.6); 
                const thetaOffset = (Math.random() - 0.5) * 0.3; 
                finalR = Math.max(0.1, coneR + rOffset);
                finalTheta = spiralTheta + thetaOffset;
                finalY = y + yOffset;
            } else {
                finalTheta = Math.random() * Math.PI * 2;
                const rRatio = Math.sqrt(Math.random()); 
                finalR = coneR * rRatio;
                finalY = y + (Math.random() - 0.5) * 3.0;
            }
            this.posT.set(Math.cos(finalTheta) * finalR, finalY, Math.sin(finalTheta) * finalR);
        }

        // --- 2. SCATTER CALCULATION ---
        let rs = 10 + Math.random() * 15;
        const th = Math.random() * Math.PI * 2;
        const ph = Math.acos(2 * Math.random() - 1);
        this.posS.set(
            rs * Math.sin(ph) * Math.cos(th),
            rs * Math.sin(ph) * Math.sin(th),
            rs * Math.cos(ph)
        );

        // --- 3. SATURN CALCULATION ---
        const isPlanet = Math.random() < 0.4; // 40% Planet Body, 60% Rings
        
        if (isPlanet) {
            // Planet Body (Sphere)
            const rPlan = 7; 
            const thetaP = Math.random() * Math.PI * 2;
            const phiP = Math.acos(2 * Math.random() - 1);
            // Dense surface + some internal volume
            const radVar = rPlan * (0.8 + Math.random() * 0.2); 
            
            this.posSat.set(
                radVar * Math.sin(phiP) * Math.cos(thetaP),
                radVar * Math.sin(phiP) * Math.sin(thetaP),
                radVar * Math.cos(phiP)
            );
        } else {
            // Rings (Disc)
            const innerR = 10;
            const outerR = 20;
            // Distribution emphasizing the disk shape
            const rRing = Math.sqrt(Math.random()) * (outerR - innerR) + innerR;
            const thetaRing = Math.random() * Math.PI * 2;
            
            // Very thin height for rings
            const yRing = (Math.random() - 0.5) * 0.4;
            
            this.posSat.set(
                rRing * Math.cos(thetaRing),
                yRing, 
                rRing * Math.sin(thetaRing)
            );
        }
        
        // Tilt Saturn (25 degrees on Z axis)
        this.posSat.applyEuler(new THREE.Euler(0, 0, Math.PI * 0.15));
    }

    upd(dt: number, mode: AppMode, focusTarget: any, mainGroupMatrix: THREE.Matrix4) {
        let tg;
        if (mode === AppMode.SCATTER) tg = this.posS;
        else if (mode === AppMode.SATURN) tg = this.posSat;
        else tg = this.posT; // TREE and others

        this.cur.lerp(tg, 2.0 * dt); 
        this.rot.x += (1.0 + Math.random()) * dt; 
        this.rot.y += (1.0 + Math.random()) * dt;
        this.s = THREE.MathUtils.lerp(this.s, this.bs, 4 * dt);
        this.updM();
    }

    updM() {
        this.mat.makeRotationFromEuler(this.rot);
        this.mat.setPosition(this.cur);
        this.mat.scale(new THREE.Vector3(this.s, this.s, this.s));
        this.mesh.setMatrixAt(this.id, this.mat);
    }
}

class PhotoParticle {
    mesh: THREE.Group;
    posT: THREE.Vector3;
    posS: THREE.Vector3;
    posSat: THREE.Vector3;
    bs: number;

    constructor(mesh: THREE.Group) {
        this.mesh = mesh;
        this.posT = new THREE.Vector3();
        this.posS = new THREE.Vector3();
        this.posSat = new THREE.Vector3();
        this.bs = mesh.scale.x;
        this.calc();
    }

    calc() {
        // Tree
        const h = 26; 
        const t = Math.random();
        const y = t * h - h / 2;
        const maxR = 11;
        const coneR = maxR * (1 - Math.pow(t, 0.85));
        const loops = 6;
        const thetaBase = t * Math.PI * 2 * loops; 
        const r = coneR + 2.0 + (Math.random() - 0.5) * 2;
        const theta = thetaBase + (Math.random() - 0.5) * 0.5;
        this.posT.set(Math.cos(theta) * r, y, Math.sin(theta) * r);

        // Scatter
        let rs = 8 + Math.random() * 12;
        const th = Math.random() * Math.PI * 2;
        const ph = Math.acos(2 * Math.random() - 1);
        this.posS.set(
            rs * Math.sin(ph) * Math.cos(th),
            rs * Math.sin(ph) * Math.sin(th),
            rs * Math.cos(ph)
        );

        // Saturn - Photos orbit in the rings
        const innerR = 12;
        const outerR = 18;
        const rRing = innerR + Math.random() * (outerR - innerR);
        const thetaRing = Math.random() * Math.PI * 2;
        this.posSat.set(
            rRing * Math.cos(thetaRing),
            (Math.random() - 0.5) * 1.0, // Slight vertical jitter
            rRing * Math.sin(thetaRing)
        );
        this.posSat.applyEuler(new THREE.Euler(0, 0, Math.PI * 0.15));
    }

    upd(dt: number, mode: AppMode, focusTarget: THREE.Object3D | null, mainGroup: THREE.Group, camera: THREE.Camera) {
        let tg;
        if (mode === AppMode.SCATTER) tg = this.posS;
        else if (mode === AppMode.SATURN) tg = this.posSat;
        else if (mode === AppMode.TREE) tg = this.posT;
        else tg = this.posS; // Default fallback

        if (mode === AppMode.FOCUS) {
            if (this.mesh === focusTarget) {
                const d = new THREE.Vector3(0, 0, 40);
                const iv = new THREE.Matrix4().copy(mainGroup.matrixWorld).invert();
                tg = d.applyMatrix4(iv);
            } else {
                // If focusing, others scatter or stay? Let's stay in scatter pos
                tg = this.posS; 
            }
        }

        this.mesh.position.lerp(tg, (this.mesh === focusTarget) ? 0.1 : 2 * dt);

        if (mode === AppMode.SCATTER || mode === AppMode.SATURN) {
            this.mesh.rotation.x += dt;
            this.mesh.rotation.y += dt;
        } else if (mode === AppMode.TREE) {
            this.mesh.rotation.x = THREE.MathUtils.lerp(this.mesh.rotation.x, 0, dt);
            this.mesh.rotation.y += 0.5 * dt;
        }

        if (mode === AppMode.FOCUS && this.mesh === focusTarget) {
             this.mesh.lookAt(camera.position);
        }

        let s = this.bs;
        if (mode === AppMode.SCATTER) s = this.bs * 2.5;
        if (mode === AppMode.SATURN) s = this.bs * 2.0;
        if (mode === AppMode.FOCUS && this.mesh === focusTarget) s = 5.5;

        this.mesh.scale.lerp(new THREE.Vector3(s, s, s), 4 * dt);
    }
}

export default function App() {
    const canvasRef = useRef<HTMLDivElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasPreviewRef = useRef<HTMLCanvasElement>(null);

    const threeRef = useRef<{
        scene: THREE.Scene;
        camera: THREE.PerspectiveCamera;
        renderer: THREE.WebGLRenderer;
        composer: EffectComposer;
        mainGroup: THREE.Group;
        particleSystem: InstancedParticle[];
        photoParticles: PhotoParticle[];
        photoMeshGroup: THREE.Group;
        instancedMeshes: { [key: string]: THREE.InstancedMesh };
        clock: THREE.Clock;
        galaxy: THREE.Points; // Added Galaxy
    } | null>(null);

    const stateRef = useRef({
        mode: AppMode.TREE,
        focusTarget: null as THREE.Object3D | null,
        rotation: { x: 0, y: 0 },
        hand: { detected: false, x: 0, y: 0 }
    });

    const [uiState, setUiState] = useState({
        status: "Ready",
        isWarn: false,
        loading: true,
        camActive: false
    });

    const [userPhotos, setUserPhotos] = useState<THREE.Object3D[]>([]);

    useEffect(() => {
        if (!canvasRef.current) return;

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(CONFIG.colors.bg);
        scene.fog = new THREE.FogExp2(CONFIG.colors.bg, 0.015);

        const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
        
        // Initial responsive camera positioning
        const aspect = window.innerWidth / window.innerHeight;
        // If portrait (aspect < 1), move camera back proportionally
        const baseZ = CONFIG.camera.z;
        camera.position.set(0, 4, aspect < 1 ? baseZ / (aspect * 0.8) : baseZ);

        const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: "high-performance" });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.toneMapping = THREE.ReinhardToneMapping;
        renderer.toneMappingExposure = 1.2; 
        canvasRef.current.appendChild(renderer.domElement);

        const mainGroup = new THREE.Group();
        scene.add(mainGroup);

        const photoMeshGroup = new THREE.Group();
        mainGroup.add(photoMeshGroup);

        // Lighting
        scene.add(new THREE.AmbientLight(0x4040ff, 0.5)); 
        const pL = new THREE.PointLight(CONFIG.colors.silver, 2, 40); 
        pL.position.set(0, 16, 0);
        mainGroup.add(pL);
        
        const spot1 = new THREE.SpotLight(CONFIG.colors.purple, 500);
        spot1.position.set(40, 10, 40);
        scene.add(spot1);
        
        const spot2 = new THREE.SpotLight(CONFIG.colors.darkBlue, 500);
        spot2.position.set(-40, 10, -40);
        scene.add(spot2);

        // Post Processing (Bloom)
        const renderPass = new RenderPass(scene, camera);
        // UPDATED: Increased threshold to 0.7 to avoid photo blooming
        const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.6, 0.8, 0.7); 
        const composer = new EffectComposer(renderer);
        composer.addPass(renderPass);
        composer.addPass(bloomPass);

        // Create Particles
        const instancedMeshes: { [key: string]: THREE.InstancedMesh } = {};
        const particleSystem: InstancedParticle[] = [];

        const gemGeo = new THREE.OctahedronGeometry(0.3, 0); 
        const shardGeo = new THREE.TetrahedronGeometry(0.35); 
        const crystalGeo = new THREE.ConeGeometry(0.15, 0.5, 4);

        // Materials - UPDATED EMISSIVE INTENSITIES (Approx +20%)
        const matDarkBlue = new THREE.MeshStandardMaterial({ 
            color: CONFIG.colors.darkBlue, 
            metalness: 0.9, roughness: 0.2,
            emissive: CONFIG.colors.darkBlue, emissiveIntensity: 0.6 // 0.5 -> 0.6
        });

        const matPurple = new THREE.MeshStandardMaterial({ 
            color: CONFIG.colors.purple, 
            metalness: 0.8, roughness: 0.2,
            emissive: CONFIG.colors.purple, emissiveIntensity: 1.0 // 0.8 -> 1.0
        });

        const matPink = new THREE.MeshStandardMaterial({ 
            color: CONFIG.colors.pink, 
            metalness: 0.7, roughness: 0.1,
            emissive: CONFIG.colors.pink, emissiveIntensity: 1.0 // 0.8 -> 1.0
        });

        const matLightBlue = new THREE.MeshStandardMaterial({
            color: CONFIG.colors.lightBlue,
            metalness: 0.8, roughness: 0.1,
            emissive: CONFIG.colors.lightBlue, emissiveIntensity: 1.2 // 1.0 -> 1.2
        });

        // Keeping definition but will use less/none
        const matSilver = new THREE.MeshStandardMaterial({
            color: CONFIG.colors.silver,
            metalness: 1.0, roughness: 0.0,
            emissive: CONFIG.colors.silver, emissiveIntensity: 2.4 // 2.0 -> 2.4
        });

        const matOrange = new THREE.MeshStandardMaterial({
            color: CONFIG.colors.orange,
            metalness: 0.5, roughness: 0.2,
            emissive: CONFIG.colors.orange, emissiveIntensity: 3.0 // 2.5 -> 3.0
        });

        // Updated counts to reflect the "Dreamy" distribution
        instancedMeshes.darkBlue = new THREE.InstancedMesh(gemGeo, matDarkBlue, 3000);
        instancedMeshes.purple = new THREE.InstancedMesh(shardGeo, matPurple, 5000);
        instancedMeshes.pink = new THREE.InstancedMesh(gemGeo, matPink, 5000);     // High Capacity
        instancedMeshes.lightBlue = new THREE.InstancedMesh(crystalGeo, matLightBlue, 8000); // Highest Capacity (Main Dreamy Color)
        instancedMeshes.silver = new THREE.InstancedMesh(shardGeo, matSilver, 500); // Minimal
        instancedMeshes.orange = new THREE.InstancedMesh(gemGeo, matOrange, 1000);  // Low Capacity (Accent)

        Object.entries(instancedMeshes).forEach(([key, mesh]) => {
            mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            mainGroup.add(mesh);
        });

        let counts = { darkBlue: 0, purple: 0, pink: 0, lightBlue: 0, silver: 0, orange: 0 };
        const TOTAL_PARTICLES = 20000; 
        
        for (let i = 0; i < TOTAL_PARTICLES; i++) {
            const r = Math.random();
            let k = 'darkBlue';
            
            // --- DREAMY DISTRIBUTION ---
            if (r < 0.05) k = 'orange';       // Very few warm particles
            else if (r < 0.30) k = 'pink';    // Lots of pink
            else if (r < 0.55) k = 'purple';  // Lots of purple
            else if (r < 0.90) k = 'lightBlue'; // Most dominant light blue
            else k = 'darkBlue';
            
            // @ts-ignore
            if (counts[k] < instancedMeshes[k].count) {
                // @ts-ignore
                particleSystem.push(new InstancedParticle(instancedMeshes[k], counts[k]++, k));
            }
        }
        
        Object.entries(instancedMeshes).forEach(([key, mesh]) => {
             // @ts-ignore
            mesh.count = counts[key];
        });

        // Ground/Galaxy Dust
        const dustGeo = new THREE.BufferGeometry();
        const dustCount = 4000;
        const dustPos = new Float32Array(dustCount * 3);
        for(let i=0; i<dustCount*3; i+=3) {
            const r = 20 + Math.random() * 40;
            const theta = Math.random() * Math.PI * 2;
            dustPos[i] = Math.cos(theta) * r;
            dustPos[i+1] = -15 + (Math.random() - 0.5) * 5;
            dustPos[i+2] = Math.sin(theta) * r;
        }
        dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
        const dustMat = new THREE.PointsMaterial({ color: 0x8888ff, size: 0.2, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending });
        const dust = new THREE.Points(dustGeo, dustMat);
        mainGroup.add(dust);

        // --- BACKGROUND SPIRAL GALAXY ---
        const galaxyGeo = new THREE.BufferGeometry();
        const galaxyCount = 15000;
        const galaxyPos = new Float32Array(galaxyCount * 3);
        const galaxyColors = new Float32Array(galaxyCount * 3);

        const colorInside = new THREE.Color(0xffd7b5); // Warm white/gold center
        const colorOutside = new THREE.Color(0x1b3984); // Deep blue edge

        for(let i = 0; i < galaxyCount; i++) {
            const i3 = i * 3;
            // Radius: Mostly far out (40-120), but some closer
            const radius = Math.random() * 100 + 35; 
            const spinAngle = radius * 0.3; 
            const branchAngle = (i % 3) * ((Math.PI * 2) / 3); // 3 Arms

            const randomX = Math.pow(Math.random(), 3) * (Math.random() < 0.5 ? 1 : -1) * 8;
            const randomY = Math.pow(Math.random(), 3) * (Math.random() < 0.5 ? 1 : -1) * 8;
            const randomZ = Math.pow(Math.random(), 3) * (Math.random() < 0.5 ? 1 : -1) * 8;

            galaxyPos[i3] = Math.cos(branchAngle + spinAngle) * radius + randomX;
            galaxyPos[i3+1] = (Math.random() - 0.5) * (radius * 0.2) + randomY; 
            galaxyPos[i3+2] = Math.sin(branchAngle + spinAngle) * radius + randomZ;

            const mixedColor = colorInside.clone();
            mixedColor.lerp(colorOutside, (radius - 35) / 100);

            galaxyColors[i3] = mixedColor.r;
            galaxyColors[i3+1] = mixedColor.g;
            galaxyColors[i3+2] = mixedColor.b;
        }

        galaxyGeo.setAttribute('position', new THREE.BufferAttribute(galaxyPos, 3));
        galaxyGeo.setAttribute('color', new THREE.BufferAttribute(galaxyColors, 3));

        const galaxyMat = new THREE.PointsMaterial({
            size: 0.3,
            sizeAttenuation: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            vertexColors: true,
            transparent: true,
            opacity: 0.8
        });

        const galaxy = new THREE.Points(galaxyGeo, galaxyMat);
        galaxy.rotation.x = Math.PI / 4; 
        galaxy.rotation.z = Math.PI / 6;
        scene.add(galaxy);

        threeRef.current = {
            scene, camera, renderer, composer, mainGroup, particleSystem,
            photoParticles: [], photoMeshGroup, instancedMeshes,
            clock: new THREE.Clock(),
            galaxy
        };

        setUiState(s => ({ ...s, loading: false }));

        const handleResize = () => {
            const w = window.innerWidth;
            const h = window.innerHeight;
            const aspect = w / h;
            
            camera.aspect = aspect;
            camera.updateProjectionMatrix();
            renderer.setSize(w, h);
            composer.setSize(w, h);

            const baseZ = CONFIG.camera.z;
            camera.position.z = aspect < 1 ? baseZ / (aspect * 0.8) : baseZ;
        };
        window.addEventListener('resize', handleResize);

        const animate = () => {
            requestAnimationFrame(animate);
            const { clock, composer, particleSystem, photoParticles, mainGroup, galaxy } = threeRef.current!;
            const dt = Math.min(clock.getDelta(), 0.1);
            const state = stateRef.current;

            if (state.mode === AppMode.SCATTER && state.hand.detected) {
                state.rotation.y += (state.hand.x * 2 - state.rotation.y) * 2 * dt;
                state.rotation.x += (state.hand.y - state.rotation.x) * 2 * dt;
            } else {
                if (state.mode === AppMode.TREE) state.rotation.y += 0.2 * dt; 
                state.rotation.x = THREE.MathUtils.lerp(state.rotation.x, 0, dt);
            }

            mainGroup.rotation.y = state.rotation.y;
            mainGroup.rotation.x = state.rotation.x;

            galaxy.rotation.y += 0.02 * dt; 

            particleSystem.forEach(p => p.upd(dt, state.mode, state.focusTarget, mainGroup.matrixWorld));
            Object.values(threeRef.current!.instancedMeshes).forEach((mesh: THREE.InstancedMesh) => {
                mesh.instanceMatrix.needsUpdate = true;
            });

            photoParticles.forEach(p => p.upd(dt, state.mode, state.focusTarget, mainGroup, camera));

            composer.render();
        };
        animate();

        return () => {
            window.removeEventListener('resize', handleResize);
            if (canvasRef.current) canvasRef.current.removeChild(renderer.domElement);
            renderer.dispose();
        };
    }, []);

    const enableCamera = async () => {
        if (!videoRef.current || !canvasPreviewRef.current) return;
        const video = videoRef.current;
        setUiState(s => ({ ...s, loading: true, status: "Loading AI..." }));

        try {
            const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm");
            const handLandmarker = await HandLandmarker.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
                    delegate: "GPU"
                },
                runningMode: "VIDEO",
                numHands: 1
            });

            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            video.srcObject = stream;
            
            setUiState(s => ({ ...s, loading: false, camActive: true, status: "AI Ready" }));

            let lastVideoTime = -1;
            let lastGesture: string | null = null;
            let stabilityCounter = 0;

            const predict = () => {
                if (!canvasPreviewRef.current) return;
                const canvas = canvasPreviewRef.current;
                const ctx = canvas.getContext('2d');
                if (!ctx) return;

                if (video.currentTime !== lastVideoTime) {
                    lastVideoTime = video.currentTime;
                    const results: HandLandmarkerResult = handLandmarker.detectForVideo(video, performance.now());
                    
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    
                    if (results.landmarks.length > 0) {
                        const lm = results.landmarks[0];
                        drawSkeleton(lm, ctx);
                        
                        const detected = analyzeGesture(lm, threeRef.current?.photoParticles.length || 0);
                        stateRef.current.hand = {
                            detected: true,
                            x: (lm[9].x - 0.5) * 2,
                            y: (lm[9].y - 0.5) * 2
                        };

                        if (detected.gesture !== lastGesture) {
                            stabilityCounter = 0;
                            lastGesture = detected.gesture;
                        } else {
                            stabilityCounter++;
                        }

                        if (stabilityCounter > 5) {
                             handleModeChange(detected.gesture, detected.text);
                        }

                    } else {
                        stateRef.current.hand.detected = false;
                    }
                }
                requestAnimationFrame(predict);
            };
            video.addEventListener("loadeddata", predict);

        } catch (err) {
            console.error(err);
            setUiState(s => ({ ...s, loading: false, status: "Camera Error", isWarn: true }));
        }
    };

    const handleModeChange = (gesture: string, text: string) => {
        if (!stateRef.current) return;
        const currentMode = stateRef.current.mode;
        
        let newMode = AppMode.TREE;
        let triggerRandom = false;

        if (gesture === 'ONE') {
            if (threeRef.current && threeRef.current.photoParticles.length > 0) {
                newMode = AppMode.FOCUS;
                triggerRandom = true;
            } else {
                newMode = currentMode;
                setUiState(s => ({ ...s, status: "⚠️ Add Photos First!", isWarn: true }));
                return;
            }
        } else if (gesture === 'PEACE') {
             newMode = AppMode.SATURN;
        } else if (gesture === 'SCATTER') {
            newMode = AppMode.SCATTER;
        } else {
            newMode = AppMode.TREE;
        }

        if (newMode !== currentMode || (newMode === AppMode.FOCUS && triggerRandom)) {
             if (currentMode === AppMode.FOCUS && newMode === AppMode.FOCUS) return;
             stateRef.current.mode = newMode;
             setUiState(s => ({ ...s, status: text, isWarn: false }));

             if (newMode === AppMode.FOCUS && threeRef.current) {
                const photos = threeRef.current.photoParticles;
                const rnd = Math.floor(Math.random() * photos.length);
                stateRef.current.focusTarget = photos[rnd].mesh;
             } else {
                stateRef.current.focusTarget = null;
             }
        }
    };

    const analyzeGesture = (lm: any[], photoCount: number) => {
        const handSize = Math.hypot(lm[9].x - lm[0].x, lm[9].y - lm[0].y);
        const isFingerOpen = (idx: number) => Math.hypot(lm[idx].x - lm[0].x, lm[idx].y - lm[0].y) > handSize * 1.5;
        
        const indexOpen = isFingerOpen(8);
        const middleOpen = isFingerOpen(12);
        const ringOpen = isFingerOpen(16);
        const pinkyOpen = isFingerOpen(20);

        const openCount = [indexOpen, middleOpen, ringOpen, pinkyOpen].filter(Boolean).length;

        // "ONE" Gesture (Index only)
        if (indexOpen && !middleOpen && !ringOpen && !pinkyOpen) {
            return { gesture: 'ONE', text: "☝️ RANDOM MEMORY" };
        } 
        // "PEACE" Gesture (Index + Middle) - triggers SATURN
        else if (indexOpen && middleOpen && !ringOpen && !pinkyOpen) {
            return { gesture: 'PEACE', text: "✌️ SATURN MODE" };
        }
        // "SCATTER" (3+ fingers)
        else if (openCount >= 3) {
            return { gesture: 'SCATTER', text: "🖐️ SCATTER" };
        } else {
            return { gesture: 'TREE', text: "✊ TREE" };
        }
    };

    const drawSkeleton = (lm: any[], ctx: CanvasRenderingContext2D) => {
        ctx.strokeStyle = "#00ff00";
        ctx.lineWidth = 2;
        ctx.beginPath();
        const connections = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
        connections.forEach(([s, e]) => {
            ctx.moveTo(lm[s].x * 160, lm[s].y * 120);
            ctx.lineTo(lm[e].x * 160, lm[e].y * 120);
        });
        ctx.stroke();
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files || !threeRef.current) return;
        Array.from(e.target.files).forEach((file: File) => {
            const reader = new FileReader();
            reader.onload = (ev) => {
                if (ev.target?.result) {
                    new THREE.TextureLoader().load(ev.target.result as string, (tex) => {
                        tex.colorSpace = THREE.SRGBColorSpace;
                        addPhotoToScene(tex);
                    });
                }
            };
            reader.readAsDataURL(file);
        });
    };

    const addPhotoToScene = (texture: THREE.Texture) => {
        const { mainGroup, photoParticles, photoMeshGroup } = threeRef.current!;
        const frameGeo = new THREE.BoxGeometry(1.4, 1.4, 0.05);
        const frameMat = new THREE.MeshStandardMaterial({ color: CONFIG.colors.orange, metalness: 0.8, roughness: 0.2 });
        const frame = new THREE.Mesh(frameGeo, frameMat);
        
        const planeGeo = new THREE.Mesh(
            new THREE.PlaneGeometry(1.2, 1.2), 
            new THREE.MeshBasicMaterial({ 
                map: texture, 
                color: 0x969696, // Increased ~10% from 0x888888
                toneMapped: true
            })
        );
        planeGeo.position.z = 0.03;

        const group = new THREE.Group();
        group.add(frame);
        group.add(planeGeo);
        
        photoMeshGroup.add(group);
        const p = new PhotoParticle(group);
        photoParticles.push(p);
        setUserPhotos(prev => [...prev, group]);
        setUiState(s => ({ ...s, status: "Photo Added!" }));
        setTimeout(() => setUiState(s => ({ ...s, status: "Ready" })), 2000);
    };

    return (
        <div className="relative w-screen h-screen bg-black overflow-hidden font-cinzel">
            <div ref={canvasRef} className="absolute inset-0 z-0" />
            <div className="absolute inset-0 z-10 pointer-events-none flex flex-col items-center pt-8 md:pt-12">
                <h1 className="text-2xl md:text-4xl italic font-bold tracking-widest text-transparent bg-clip-text bg-gradient-to-b from-white to-indigo-400 drop-shadow-[0_0_25px_rgba(200,200,255,0.6)]">
                    MERRY CHRISTMAS
                </h1>
                <div className={`mt-6 px-6 py-2 rounded-full border bg-black/80 transition-all duration-300 ${uiState.isWarn ? 'border-red-500 text-red-500' : 'border-indigo-500/60 text-indigo-200'}`}>
                    <span className="uppercase tracking-widest font-bold">{uiState.status}</span>
                </div>
                <div className="mt-8 flex flex-col gap-4 pointer-events-auto items-center">
                    {!uiState.camActive ? (
                        <button 
                            onClick={enableCamera}
                            className="group relative px-8 py-3 bg-gray-900/60 border border-green-500 text-green-400 uppercase tracking-widest text-xs rounded hover:bg-green-500 hover:text-black transition-all duration-300 shadow-[0_0_15px_rgba(0,255,0,0.2)] hover:shadow-[0_0_30px_rgba(0,255,0,0.6)]"
                        >
                            📸 Enable Camera Control
                        </button>
                    ) : (
                         <div className="text-white/50 text-[10px] text-center leading-relaxed backdrop-blur-md bg-black/40 p-2 rounded border border-white/10">
                            GESTURES ACTIVE<br/>
                            ☝️ Index: Memory<br/>
                            ✌️ Peace: Saturn<br/>
                            🖐️ Open: Scatter<br/>
                            ✊ Fist: Tree
                        </div>
                    )}
                    <label className="cursor-pointer group relative px-8 py-3 bg-gray-900/60 border border-indigo-500/50 text-indigo-300 uppercase tracking-widest text-xs rounded hover:bg-indigo-500 hover:text-black transition-all duration-300 backdrop-blur-sm">
                        <span>Upload Memories</span>
                        <input type="file" multiple accept="image/*" onChange={handleFileUpload} className="hidden" />
                    </label>
                </div>
            </div>
            <div className={`fixed bottom-8 right-8 w-40 h-32 border-2 rounded-lg overflow-hidden transition-all duration-500 bg-black z-30 ${uiState.camActive ? 'opacity-100 border-indigo-500/50' : 'opacity-0 pointer-events-none border-white/20'}`}>
                <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover scale-x-[-1]" />
                <canvas ref={canvasPreviewRef} width="160" height="120" className="absolute inset-0 w-full h-full scale-x-[-1] pointer-events-none" />
            </div>
            {uiState.loading && (
                <div className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center transition-opacity duration-700">
                    <div className="w-12 h-12 border-2 border-indigo-900 border-t-indigo-500 rounded-full animate-spin mb-4"></div>
                    <div className="text-indigo-400 text-xs tracking-widest">LOADING EXPERIENCE...</div>
                </div>
            )}
        </div>
    );
}