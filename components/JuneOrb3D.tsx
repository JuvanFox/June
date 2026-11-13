import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { ConnectionState } from '../types';

interface JuneOrb3DProps {
  volume: number;
  state: ConnectionState;
  onClick?: () => void;
}

const JuneOrb3D: React.FC<JuneOrb3DProps> = ({ volume, state, onClick }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const volumeRef = useRef(volume);
  const stateRef = useRef(state);

  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth || 420;
    const height = container.clientHeight || 420;

    // Scene, Camera, Renderer
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.z = 5.2;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    container.appendChild(renderer.domElement);

    const orbGroup = new THREE.Group();
    scene.add(orbGroup);

    // 1. Lighting Setup (Studio warm aesthetic)
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xfff6eb, 2.5);
    keyLight.position.set(4, 5, 4);
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0xd4b27a, 2.0);
    rimLight.position.set(-4, -2, -3);
    scene.add(rimLight);

    const corePointLight = new THREE.PointLight(0xe8c794, 2.0, 8);
    orbGroup.add(corePointLight);

    // 2. Central Fluid Obsidian/Champagne Sphere
    // 56x56 segments for smooth organic liquid displacement
    const sphereGeo = new THREE.SphereGeometry(1.05, 56, 56);
    const sphereMat = new THREE.MeshStandardMaterial({
      color: 0x14161c,
      roughness: 0.22,
      metalness: 0.82,
      wireframe: false,
    });
    const sphereMesh = new THREE.Mesh(sphereGeo, sphereMat);
    orbGroup.add(sphereMesh);

    // Keep original vertex positions for fluid wave distortion
    const baseSpherePositions = sphereGeo.attributes.position.clone();

    // 3. Inner Acoustic Wireform
    const innerGeo = new THREE.IcosahedronGeometry(0.85, 2);
    const innerMat = new THREE.MeshBasicMaterial({
      color: 0xecd7b2,
      wireframe: true,
      transparent: true,
      opacity: 0.18,
    });
    const innerMesh = new THREE.Mesh(innerGeo, innerMat);
    orbGroup.add(innerMesh);

    // 4. Starlight Atmosphere Particles
    const particleCount = 850;
    const particleGeo = new THREE.BufferGeometry();
    const particlePos = new Float32Array(particleCount * 3);
    const baseParticlePos = new Float32Array(particleCount * 3);
    const particleColors = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount; i++) {
      const phi = Math.acos(-1 + (2 * i) / particleCount);
      const theta = Math.sqrt(particleCount * Math.PI) * phi;
      const radius = 1.48 + (Math.random() - 0.5) * 0.25;

      const x = radius * Math.cos(theta) * Math.sin(phi);
      const y = radius * Math.sin(theta) * Math.sin(phi);
      const z = radius * Math.cos(phi);

      particlePos[i * 3] = x;
      particlePos[i * 3 + 1] = y;
      particlePos[i * 3 + 2] = z;

      baseParticlePos[i * 3] = x;
      baseParticlePos[i * 3 + 1] = y;
      baseParticlePos[i * 3 + 2] = z;

      // Warm ivory & champagne starlight palette
      const tint = Math.random();
      if (tint > 0.6) {
        // Champagne gold
        particleColors[i * 3] = 0.92;
        particleColors[i * 3 + 1] = 0.78;
        particleColors[i * 3 + 2] = 0.55;
      } else if (tint > 0.3) {
        // Soft pearl ivory
        particleColors[i * 3] = 0.95;
        particleColors[i * 3 + 1] = 0.93;
        particleColors[i * 3 + 2] = 0.88;
      } else {
        // Subtle muted slate gold
        particleColors[i * 3] = 0.72;
        particleColors[i * 3 + 1] = 0.68;
        particleColors[i * 3 + 2] = 0.60;
      }
    }

    particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePos, 3));
    particleGeo.setAttribute('color', new THREE.BufferAttribute(particleColors, 3));

    const particleMat = new THREE.PointsMaterial({
      size: 0.024,
      vertexColors: true,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
    });
    const particleCloud = new THREE.Points(particleGeo, particleMat);
    orbGroup.add(particleCloud);

    // 5. Minimalist Equatorial Acoustic Halo
    const haloGeo = new THREE.TorusGeometry(1.85, 0.008, 16, 120);
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0xd6b683,
      transparent: true,
      opacity: 0.35,
    });
    const haloMesh = new THREE.Mesh(haloGeo, haloMat);
    haloMesh.rotation.x = Math.PI * 0.38;
    orbGroup.add(haloMesh);

    // Mouse parallax tracking
    let targetRotX = 0;
    let targetRotY = 0;

    const onMouseMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      targetRotY = x * 0.28;
      targetRotX = -y * 0.28;
    };

    window.addEventListener('mousemove', onMouseMove);

    // Resize handler
    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth || 420;
      const h = container.clientHeight || 420;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    window.addEventListener('resize', handleResize);

    // Animation Loop
    let animId: number;
    const startTime = performance.now();

    const animate = () => {
      animId = requestAnimationFrame(animate);
      const elapsedTime = (performance.now() - startTime) * 0.001;
      const vol = volumeRef.current || 0;
      const curState = stateRef.current;

      // Mouse follow damping
      orbGroup.rotation.y += (targetRotY - orbGroup.rotation.y) * 0.04;
      orbGroup.rotation.x += (targetRotX - orbGroup.rotation.x) * 0.04;

      // Ambient rotation
      const speedMult = curState === ConnectionState.CONNECTED ? 1.2 : 0.6;
      orbGroup.rotation.y += 0.003 * speedMult;
      haloMesh.rotation.z += 0.004 * speedMult;
      innerMesh.rotation.y -= 0.005 * speedMult;

      // Color theme based on state:
      // CONNECTED: Warm Champagne / Soft Sage
      // CONNECTING: Warm Amber
      // DISCONNECTED: Subtle Oyster / Warm Titanium
      // ERROR: Rosewood
      let targetHaloColor = 0xd6b683; // Champagne
      let targetCoreLight = 0xe8c794;

      if (curState === ConnectionState.CONNECTED) {
        targetHaloColor = 0xc2cfa8; // Soft muted sage-champagne
        targetCoreLight = 0xd7e0b5;
        sphereMat.color.setHex(0x181c1a);
      } else if (curState === ConnectionState.CONNECTING) {
        targetHaloColor = 0xe8b476; // Warm amber
        targetCoreLight = 0xf5c389;
        sphereMat.color.setHex(0x1d1914);
      } else if (curState === ConnectionState.ERROR) {
        targetHaloColor = 0xd97575;
        targetCoreLight = 0xeb8888;
        sphereMat.color.setHex(0x201515);
      } else {
        sphereMat.color.setHex(0x14161c);
      }

      haloMat.color.setHex(targetHaloColor);
      corePointLight.color.setHex(targetCoreLight);

      // Acoustic Fluid wave displacement on the sphere surface
      const posAttr = sphereGeo.attributes.position as THREE.BufferAttribute;
      const basePosArr = baseSpherePositions.array as Float32Array;
      const posArr = posAttr.array as Float32Array;
      const vertexCount = posAttr.count;

      const waveStrength = 0.02 + vol * 0.35;
      const timeOffset = elapsedTime * (2.0 + vol * 4.0);

      for (let i = 0; i < vertexCount; i++) {
        const idx = i * 3;
        const bx = basePosArr[idx];
        const by = basePosArr[idx + 1];
        const bz = basePosArr[idx + 2];

        // Spherical harmonics ripple
        const ripple = Math.sin(bx * 3.5 + timeOffset) * Math.cos(by * 3.5 + timeOffset * 0.8) * Math.sin(bz * 3.5 + timeOffset * 1.2);
        const factor = 1.0 + ripple * waveStrength;

        posArr[idx] = bx * factor;
        posArr[idx + 1] = by * factor;
        posArr[idx + 2] = bz * factor;
      }
      posAttr.needsUpdate = true;
      sphereGeo.computeVertexNormals();

      // Breathing scale
      const breathe = Math.sin(elapsedTime * 1.8) * 0.02;
      const totalScale = 1.0 + breathe + vol * 0.45;
      sphereMesh.scale.set(totalScale, totalScale, totalScale);
      innerMesh.scale.set(totalScale * 0.92, totalScale * 0.92, totalScale * 0.92);

      // Halo reacts to volume
      haloMesh.scale.setScalar(1.0 + vol * 0.5);
      haloMat.opacity = 0.25 + vol * 0.45;

      // Core point light pulse
      corePointLight.intensity = 1.2 + vol * 6.0;

      // Particle displacement
      const pPosAttr = particleGeo.attributes.position as THREE.BufferAttribute;
      const pArr = pPosAttr.array as Float32Array;

      for (let i = 0; i < particleCount; i++) {
        const idx = i * 3;
        const bx = baseParticlePos[idx];
        const by = baseParticlePos[idx + 1];
        const bz = baseParticlePos[idx + 2];

        const pWave = Math.sin(elapsedTime * 2.2 + bx * 2.0) * (0.03 + vol * 0.25);
        const dist = Math.sqrt(bx * bx + by * by + bz * bz);
        const factor = (dist + pWave) / dist;

        pArr[idx] = bx * factor * totalScale;
        pArr[idx + 1] = by * factor * totalScale;
        pArr[idx + 2] = bz * factor * totalScale;
      }
      pPosAttr.needsUpdate = true;

      renderer.render(scene, camera);
    };

    animate();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('resize', handleResize);
      if (renderer.domElement && container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      sphereGeo.dispose();
      sphereMat.dispose();
      baseSpherePositions.dispose();
      innerGeo.dispose();
      innerMat.dispose();
      particleGeo.dispose();
      particleMat.dispose();
      haloGeo.dispose();
      haloMat.dispose();
      renderer.dispose();
    };
  }, []);

  return (
    <div 
      ref={containerRef} 
      onClick={onClick}
      className="w-full h-full relative cursor-pointer flex items-center justify-center select-none"
      title="Click to toggle June's voice connection"
    />
  );
};

export default JuneOrb3D;
