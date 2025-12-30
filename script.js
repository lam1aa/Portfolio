import * as THREE from "https://esm.sh/three@0.160.0";

gsap.registerPlugin(ScrollTrigger);

const canvas = document.getElementById("canvas");
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 0); // Set clear color with 0 alpha

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const scene = new THREE.Scene();

const fragmentShader = `
            precision highp float;
            
            uniform vec2 iResolution;
            uniform float iTime;
            uniform vec4 iMouse;
            uniform float iScrollOffset;
            uniform float iScrollSpeed;
            uniform float iScrollProgress; // Overall scroll progress (0-1)
            uniform float grainStrength; // Grain effect strength
            uniform float grainSize; // Grain size control
            
            #define S(a, b, t) smoothstep(a, b, t)
            #define sat(x) clamp(x, 0.0, 1.0)
            #define SPHERECOL vec3(0.988, 0.82, 0.843)
            #define NUM_SPHERES 50.0
            #define NUM_DUST 200.0
            #define LIGHT_DIR vec3(0.577, -0.577, -0.577)
            #define BASE_SPHERE_SIZE 1.0
            #define DUST_SIZE 0.05
            
            // Improved noise functions for grain effect
            float hash(vec2 p) {
                p = fract(p * vec2(123.34, 456.21));
                p += dot(p, p + 45.32);
                return fract(p.x * p.y);
            }
            
            float hash(float n) {
                return fract(sin(n) * 43758.5453);
            }
            
            // Polynomial smooth max from IQ
            float smax(float a, float b, float k) {
                float h = sat(0.5 + 0.5*(b-a)/k);
                return mix(a, b, h) + k*h*(1.0-h);
            }
            
            // Simple sphere function
            float Sphere(vec2 uv, float b) {
                return S(b, -b, length(uv) - 0.5);
            }
            
            // Quaternion rotation functions
            vec4 qmulq(vec4 q1, vec4 q2) {
                return vec4(q1.xyz*q2.w+q2.xyz*q1.w+cross(q1.xyz,q2.xyz), (q1.w*q2.w)-dot(q1.xyz,q2.xyz));
            }
            
            vec4 aa2q(vec3 axis, float angle) {
                return vec4(normalize(axis)*sin(angle*0.5), cos(angle*0.5));
            }
            
            vec4 qinv(vec4 q) {
                return vec4(-q.xyz, q.w)/dot(q, q);
            }
            
            vec3 qmulv(vec4 q, vec3 p) {
                return qmulq(q, qmulq(vec4(p, 0.0), qinv(q))).xyz;
            }
            
            // Ray-sphere intersection
            vec2 RaySphere(vec3 rd, vec3 p, float radius) {
                float l = dot(rd, p);
                float det = l*l - dot(p, p) + radius*radius;
                if (det < 0.0) return vec2(-1.0);
                float sd = sqrt(det);
                return vec2(l - sd, l + sd);
            }
            
            struct sphereInfo {
                vec3 p1, p2, n1, n2;
                vec2 uv1, uv2;
            };
            
            sphereInfo GetSphereUvs(vec3 rd, vec2 i, vec2 rot, vec3 s, float radius) {
                sphereInfo res;
                rot *= 6.2831;
                vec4 q = aa2q(vec3(cos(rot.x), sin(rot.x), 0.0), rot.y);
                vec3 o = qmulv(q, -s) + s;
                vec3 d = qmulv(q, rd);
                
                res.p1 = rd * i.x;
                vec3 p = o + d*i.x - s;
                res.uv1 = vec2(atan(p.x, p.z), p.y);
                res.n1 = res.p1 - s;
                
                res.p2 = rd * i.y;
                p = o + d*i.y - s;
                res.uv2 = vec2(atan(p.x, p.z), p.y);
                res.n2 = s - res.p2;
                    
                return res;
            }
            
            vec4 SphereBall(vec3 rd, vec3 p, vec2 rot, float radius, float blur) {
                vec2 d = RaySphere(rd, p, radius);
                
                vec4 col = vec4(0.0);
                if(d.x > 0.0) {
                    sphereInfo info = GetSphereUvs(rd, d, rot, p, radius);
                    
                    float sd = length(cross(p, rd));
                    float edge = S(radius, mix(radius, 0.1, blur), sd);
                    
                    float backMask = Sphere(info.uv2 / radius, blur) * edge; 
                    float frontMask = Sphere(info.uv1 / radius, blur) * edge; 
                    float frontLight = sat(dot(LIGHT_DIR, normalize(info.n1)) * 0.8 + 0.2);
                    float backLight = sat(dot(LIGHT_DIR, normalize(info.n2)) * 0.8 + 0.2) * 0.9;
                    col = mix(vec4(backLight * SPHERECOL, backMask), 
                            vec4(frontLight * SPHERECOL, frontMask), 
                            frontMask);
                }
                return col;
            }
            
            void main() {
                vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
                vec2 m = iMouse.xy / iResolution.xy;
                float t = iTime * 0.3;
                
                // Apply camera movement based on scroll progress
                float cameraY = iScrollProgress * 1.5; // Reduced from 5.0
                uv.y += cameraY;
                
                // Also add some subtle rotation/movement based on scroll
                float scrollAngle = iScrollProgress * 0.05; // Reduced from 0.2
                uv = mat2(cos(scrollAngle), -sin(scrollAngle), sin(scrollAngle), cos(scrollAngle)) * uv;
            
                vec3 rd = normalize(vec3(uv, 1.0));
                
                m.y = iMouse.z > 0.0 ? 1.0 - m.y : 0.4;
                vec2 rot = t * vec2(0.12, 0.18);
                vec4 col = vec4(0.0);
                
                // Main spheres
                for(float i = 0.0; i < 1.0; i += (1.0 / NUM_SPHERES)) {
                    // Create unique position
                    float hashX = fract(sin(i * 536.3) * 7464.4);
                    float hashY = fract(sin(i * 234.5) * 8573.2);
                    float hashZ = fract(sin(i * 657.8) * 9456.3);
                    
                    float x = (hashX * 2.0 - 1.0) * 15.0;
                    
                    // Y position controlled by scroll
                    float baseY = (hashY * 2.0 - 1.0) * 15.0;
                    float y = mod(baseY - iScrollOffset * 0.4, 30.0) - 15.0; // Reduced multiplier from 1.0 to 0.4
                    
                    // Z depth with variation
                    float z = mix(14.0, 2.0, i);
                    
                    // Size varies with depth - closer spheres are bigger
                    float depthFactor = 1.0 - (z - 2.0) / 12.0; // 1.0 at z=2, 0.0 at z=14
                    float sizeBoost = mix(1.0, 1.8, depthFactor); // Spheres at front are up to 1.8x bigger
                    float sphereRadius = BASE_SPHERE_SIZE * sizeBoost;
                    
                    // Calculate blur based on focus plane (from mouse)
                    float blur = mix(0.03, 0.35, S(0.0, 0.4, abs(m.y - i)));
                    
                    // Add some variation to rotation
                    rot += (fract(sin(i * vec2(536.3, 23.4)) * vec2(764.4, 987.3)) - 0.5);
                    
                    // Apply scroll-based rotation to spheres
                    rot.y += iScrollProgress * hashX * 0.5; // Reduced from 2.0
                    
                    // Render the sphere
                    vec4 sphere = SphereBall(rd, vec3(x, y, z), rot, sphereRadius, blur);
                    
                    // Composite with alpha blending
                    col = mix(col, sphere, sphere.a * (1.0 - col.a));
                }
                
                // Add small dust particles
                for(float i = 0.0; i < 1.0; i += (1.0 / NUM_DUST)) {
                    // Different hash for dust
                    float hashX = fract(sin(i * 1234.5) * 5432.1);
                    float hashY = fract(sin(i * 6543.2) * 3210.9);
                    float hashZ = fract(sin(i * 9876.5) * 2109.8);
                    float hashW = fract(sin(i * 5432.1) * 9876.5);
                    
                    // Wider distribution for dust
                    float x = (hashX * 2.0 - 1.0) * 25.0;
                    
                    // Y position with continuous falling motion + scroll reaction
                    float fallSpeed = hashZ * 0.5 + 0.2; // Variable fall speed for each particle
                    float baseY = (hashY * 2.0 - 1.0) * 25.0;
                    float timeY = mod(baseY - t * fallSpeed, 50.0) - 25.0; // Continuous falling
                    float y = mod(timeY - iScrollOffset * (0.2 + hashW * 0.3), 50.0) - 25.0; // Reduced from 0.6+0.8 to 0.2+0.3
                    
                    // Subtle horizontal drift
                    x += sin(t * (0.2 + hashX * 0.3) + hashY * 10.0) * 0.3;
                    
                    // Z depth with variation
                    float z = mix(18.0, 1.0, hashZ);
                    
                    // Even smaller for dust that's further away
                    float depthFactor = 1.0 - (z - 1.0) / 15.0;
                    float dustRadius = DUST_SIZE * (0.5 + hashX * 0.5);
                    
                    // Use different blur calculation for dust
                    float blur = mix(0.05, 0.4, S(0.0, 0.3, abs(m.y - hashZ)));
                    
                    // Simpler rotation for dust
                    vec2 dustRot = t * vec2(0.05, 0.08) + hashX;
                    
                    // Render dust with higher transparency
                    vec4 dust = SphereBall(rd, vec3(x, y, z), dustRot, dustRadius, blur);
                    dust.a *= 0.4; // Make dust more transparent
                    
                    // Composite dust
                    col = mix(col, dust, dust.a * (1.0 - col.a));
                }
                
                // Add subtle color tint based on scroll position
                float tintAmount = iScrollProgress * 0.3;
                vec3 tintColor = mix(vec3(1.0, 1.0, 1.0), vec3(0.9, 0.95, 1.1), tintAmount);
                col.rgb *= tintColor;
                
                // Apply grain effect
                vec2 uvRandom = uv;
                uvRandom.y *= hash(vec2(uvRandom.y, t * 0.01));
                float noise = hash(uvRandom * grainSize + t * 0.1) * grainStrength;
                col.rgb += noise - grainStrength * 0.5; // Center the noise around zero
                
                gl_FragColor = col;
            }
        `;

const vertexShader = `
            void main() {
                gl_Position = vec4(position, 1.0);
            }
        `;

const material = new THREE.ShaderMaterial({
  uniforms: {
    iResolution: {
      value: new THREE.Vector2(window.innerWidth, window.innerHeight)
    },
    iTime: { value: 0 },
    iMouse: { value: new THREE.Vector4(0, 0, 0, 0) },
    iScrollOffset: { value: 0 },
    iScrollSpeed: { value: 0 },
    iScrollProgress: { value: 0 },
    grainStrength: { value: 0.15 },
    grainSize: { value: 3.5 }
  },
  fragmentShader: fragmentShader,
  vertexShader: vertexShader,
  transparent: true
});

const geometry = new THREE.PlaneGeometry(2, 2);
const mesh = new THREE.Mesh(geometry, material);
scene.add(mesh);

// Scroll variables with more smoothing
let lastY = 0;
let scrollOffset = 0;
const scrollBuffer = Array(10).fill(0); // Buffer for smoothing
let bufferIndex = 0;

// Calculate total scrollable height for progress calculation
const totalScrollHeight = document.body.scrollHeight - window.innerHeight;

// Set up GSAP animations for each section
const sections = document.querySelectorAll(".section");
const quotes = document.querySelectorAll(".quote");

sections.forEach((section, index) => {
  const title = section.querySelector(".title");
  const description = section.querySelector(".description");

  ScrollTrigger.create({
    trigger: section,
    start: "top 80%",
    end: "bottom 20%",
    onEnter: () => {
      gsap.to(title, {
        opacity: 1,
        y: 0,
        duration: 0.8,
        ease: "power3.out"
      });
      gsap.to(description, {
        opacity: 1,
        y: 0,
        duration: 0.8,
        delay: 0.2,
        ease: "power3.out"
      });
    },
    onLeaveBack: () => {
      gsap.to(title, {
        opacity: 0,
        y: 50,
        duration: 0.5
      });
      gsap.to(description, {
        opacity: 0,
        y: 30,
        duration: 0.5
      });
    }
  });
});

// Set up animations for quotes
quotes.forEach((quote) => {
  ScrollTrigger.create({
    trigger: quote,
    start: "top 80%",
    onEnter: () => {
      gsap.to(quote, {
        opacity: 1,
        y: 0,
        duration: 1.2,
        ease: "power2.out"
      });
    },
    onLeaveBack: () => {
      gsap.to(quote, {
        opacity: 0,
        y: 30,
        duration: 0.5
      });
    }
  });
});

// Set up ScrollTrigger for shader animations
ScrollTrigger.create({
  trigger: "body",
  start: "top top",
  end: "bottom bottom",
  onUpdate: (self) => {
    const currentY = window.scrollY;
    const delta = currentY - lastY;

    // Calculate overall scroll progress (0-1)
    const scrollProgress = currentY / totalScrollHeight;
    material.uniforms.iScrollProgress.value = scrollProgress;

    // Only update if there's significant movement
    if (Math.abs(delta) > 0.5) {
      // Add to circular buffer
      scrollBuffer[bufferIndex] = delta;
      bufferIndex = (bufferIndex + 1) % scrollBuffer.length;

      // Calculate average scroll speed from buffer
      let avgDelta = 0;
      for (let i = 0; i < scrollBuffer.length; i++) {
        avgDelta += scrollBuffer[i];
      }
      avgDelta /= scrollBuffer.length;

      // Apply smoothed movement
      scrollOffset += avgDelta * 0.03; // Reduced from 0.08 for slower movement

      // Update shader uniforms
      material.uniforms.iScrollSpeed.value = avgDelta * 0.01;
    } else {
      material.uniforms.iScrollSpeed.value *= 0.9; // Dampen scroll speed
    }

    material.uniforms.iScrollOffset.value = scrollOffset;
    lastY = currentY;
  }
});

// Handle mouse events for DOF control
window.addEventListener("mousemove", (event) => {
  material.uniforms.iMouse.value.x = event.clientX;
  material.uniforms.iMouse.value.y = event.clientY;
});

window.addEventListener("mousedown", () => {
  material.uniforms.iMouse.value.z = 1;
});

window.addEventListener("mouseup", () => {
  material.uniforms.iMouse.value.z = 0;
});

// Handle window resize
window.addEventListener("resize", () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  material.uniforms.iResolution.value.x = window.innerWidth;
  material.uniforms.iResolution.value.y = window.innerHeight;
});

// Animation loop
function animate(time) {
  material.uniforms.iTime.value = time * 0.001;
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

requestAnimationFrame(animate);
