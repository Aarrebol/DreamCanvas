document.addEventListener("DOMContentLoaded", () => {
    // --- 1. Canvas 基本状态与配置 ---
    const canvas = document.getElementById("drawingCanvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    
    let isDrawing = false;
    let lastX = 0;
    let lastY = 0;
    let isEraser = false;
    
    // 初始化画布背景为纯白 (这对于生图大模型识别非常关键，不能是透明的)
    function initCanvas() {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        // 设置默认画笔样式
        ctx.strokeStyle = "#000000";
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.lineWidth = 6;
    }
    
    initCanvas();

    // --- 2. DOM 工具元素获取 ---
    const colorPicker = document.getElementById("colorPicker");
    const brushSizeInput = document.getElementById("brushSize");
    const sizeValueSpan = document.getElementById("sizeValue");
    const presetColors = document.querySelectorAll(".preset-color");
    const btnEraser = document.getElementById("btnEraser");
    const btnClear = document.getElementById("btnClear");
    
    const promptInput = document.getElementById("promptInput");
    const btnGenerate = document.getElementById("btnGenerate");
    const btnText = btnGenerate.querySelector(".btn-text");
    const btnLoader = btnGenerate.querySelector(".btn-loader");
    
    const refStrengthInput = document.getElementById("refStrength");
    const strengthDisplay = document.getElementById("strengthDisplay");
    
    const placeholderWrapper = document.getElementById("placeholderWrapper");
    const loadingOverlay = document.getElementById("loadingOverlay");
    const resultImageWrapper = document.getElementById("resultImageWrapper");
    const resultImg = document.getElementById("resultImg");
    const downloadBtn = document.getElementById("downloadBtn");
    const errorMessage = document.getElementById("errorMessage");

    // --- 3. 交互逻辑（滑块状态更新） ---
    
    // 美化力度滑块的文案动态更新（越低=越美化，越高=越复刻）
    refStrengthInput.addEventListener("input", (e) => {
        const val = parseFloat(e.target.value);
        let desc = "";
        if (val <= 0.3) {
            desc = `🌈 创意上色 (${val}) — AI 自由发挥`;
        } else if (val <= 0.6) {
            desc = `✨ 推荐美化 (${val}) — 兼顾形状与上色`;
        } else {
            desc = `📋 原样复刻 (${val}) — 接近原图`;
        }
        strengthDisplay.textContent = desc;
    });

    // 获取缩放后的鼠标/触摸在画布上的精确坐标
    function getPosition(e) {
        const rect = canvas.getBoundingClientRect();
        // 计算缩放比例 (因为 CSS 可能对 512x512 的物理像素进行了缩放显示)
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        
        let clientX, clientY;
        
        // 兼容触屏 Touch 事件
        if (e.touches && e.touches.length > 0) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else {
            clientX = e.clientX;
            clientY = e.clientY;
        }
        
        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY
        };
    }

    // 更新画笔粗细 UI 展示
    brushSizeInput.addEventListener("input", (e) => {
        const size = e.target.value;
        sizeValueSpan.textContent = `${size}px`;
        if (!isEraser) {
            ctx.lineWidth = size;
        }
    });

    // 取色器发生变化
    colorPicker.addEventListener("input", (e) => {
        isEraser = false;
        btnEraser.classList.remove("active");
        ctx.strokeStyle = e.target.value;
        
        // 取消预置颜色的高亮状态
        presetColors.forEach(p => p.classList.remove("active"));
    });

    // 预置调色盘点击
    presetColors.forEach(preset => {
        preset.addEventListener("click", () => {
            isEraser = false;
            btnEraser.classList.remove("active");
            
            // 更新高亮样式
            presetColors.forEach(p => p.classList.remove("active"));
            preset.classList.add("active");
            
            const color = preset.getAttribute("data-color");
            ctx.strokeStyle = color;
            colorPicker.value = color; // 同步到系统选择器展示
        });
    });

    // 橡皮擦逻辑 (原理是将笔刷颜色强制设为纯白画布背景色)
    btnEraser.addEventListener("click", () => {
        isEraser = !isEraser;
        if (isEraser) {
            btnEraser.classList.add("active");
            ctx.strokeStyle = "#ffffff"; // 背景色
            ctx.lineWidth = brushSizeInput.value * 2; // 橡皮擦适当加粗以便擦除
        } else {
            btnEraser.classList.remove("active");
            ctx.strokeStyle = colorPicker.value;
            ctx.lineWidth = brushSizeInput.value;
        }
    });

    // 一键清空画布
    btnClear.addEventListener("click", () => {
        if (confirm("确定要清空画布重新创作吗？")) {
            initCanvas();
            // 如果在橡皮擦模式下，清空后可以重置为普通画笔
            if (isEraser) {
                isEraser = false;
                btnEraser.classList.remove("active");
                ctx.strokeStyle = colorPicker.value;
                ctx.lineWidth = brushSizeInput.value;
            }
        }
    });

    // --- 4. 绘图核心功能 (Mouse & Touch) ---
    
    function startDrawing(e) {
        isDrawing = true;
        const pos = getPosition(e);
        lastX = pos.x;
        lastY = pos.y;
        
        // 单击也能画一个点
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, ctx.lineWidth / 2, 0, Math.PI * 2);
        ctx.fillStyle = ctx.strokeStyle;
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
        
        // 阻止触屏浏览器的默认滚动行为
        if (e.cancelable) e.preventDefault();
    }

    function draw(e) {
        if (!isDrawing) return;
        const pos = getPosition(e);
        
        ctx.beginPath();
        ctx.moveTo(lastX, lastY);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
        
        lastX = pos.x;
        lastY = pos.y;
        
        if (e.cancelable) e.preventDefault();
    }

    function stopDrawing() {
        isDrawing = false;
        ctx.beginPath();
    }

    // 绑定鼠标事件
    canvas.addEventListener("mousedown", startDrawing);
    canvas.addEventListener("mousemove", draw);
    canvas.addEventListener("mouseup", stopDrawing);
    canvas.addEventListener("mouseout", stopDrawing);

    // 绑定触屏事件
    canvas.addEventListener("touchstart", startDrawing, { passive: false });
    canvas.addEventListener("touchmove", draw, { passive: false });
    canvas.addEventListener("touchend", stopDrawing);

    // --- 5. 后端 API 数据提交与魔法处理 ---
    
    btnGenerate.addEventListener("click", async () => {
        const prompt = promptInput.value.trim();
        
        if (!prompt) {
            alert("请在魔法控制台输入你的奇思妙想提示词！");
            promptInput.focus();
            return;
        }

        // 进入加载动画状态
        errorMessage.classList.add("hidden");
        placeholderWrapper.classList.add("hidden");
        resultImageWrapper.classList.add("hidden");
        loadingOverlay.classList.remove("hidden");
        
        btnGenerate.disabled = true;
        btnText.classList.add("hidden");
        btnLoader.classList.remove("hidden");

        try {
            // 1. 关键优化：获取当前画布并强制转换为【高对比度黑白单色简笔画】
            // 因为通义万相 Sketch 模型（Canny 算子）对浅色霓虹笔画（如亮青色、粉色）极不敏感，会当做大白底过滤掉！
            // 我们通过在内存中建立一个隐藏临时画布，进行像素灰度阈值判定，将所有非白色像素暴力“拉黑”，以保证 100% 识别轮廓！
            const tempCanvas = document.createElement("canvas");
            tempCanvas.width = canvas.width;
            tempCanvas.height = canvas.height;
            const tempCtx = tempCanvas.getContext("2d");
            
            // 复制当前用户的涂鸦
            tempCtx.drawImage(canvas, 0, 0);
            
            const imgData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
            const data = imgData.data;
            
            for (let i = 0; i < data.length; i += 4) {
                const r = data[i];
                const g = data[i + 1];
                const b = data[i + 2];
                
                // 计算灰度值或判断是否偏白（RGB 均大于 240 则认为是背景底色）
                if (r > 240 && g > 240 && b > 240) {
                    data[i] = 255;     // 纯白底
                    data[i + 1] = 255;
                    data[i + 2] = 255;
                    data[i + 3] = 255; // 强制不透明，保证 PNG 图片头结构完整合法
                } else {
                    data[i] = 0;       // 所有画笔颜色无论深浅，统统拉为纯黑线！
                    data[i + 1] = 0;
                    data[i + 2] = 0;
                    data[i + 3] = 255; // 强制不透明，确保高对比度
                }
            }
            
            tempCtx.putImageData(imgData, 0, 0);
            // 导出高对比度纯净简笔画的 Base64 串给大模型
            const imageDataBase64 = tempCanvas.toDataURL("image/png");

            // 2. 构造 FormData
            const formData = new FormData();
            formData.append("prompt", prompt);
            formData.append("image_data", imageDataBase64);
            formData.append("ref_strength", refStrengthInput.value);

            // 3. 发起 API 请求
            const response = await fetch("/api/generate", {
                method: "POST",
                body: formData
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || `生成过程中断 (状态码 ${response.status})`);
            }

            if (result.success && result.image_url) {
                // 渲染生成的画作
                resultImg.src = result.image_url;
                downloadBtn.href = result.image_url;
                
                // 预加载图片确保显示平滑
                resultImg.onload = () => {
                    loadingOverlay.classList.add("hidden");
                    resultImageWrapper.classList.remove("hidden");
                };
            } else {
                throw new Error("后端返回了成功的响应，但未找到图片数据。");
            }

        } catch (error) {
            console.error("魔法释放失败:", error);
            loadingOverlay.classList.add("hidden");
            placeholderWrapper.classList.remove("hidden");
            
            // 显示华丽的错误提示条
            errorMessage.textContent = `💥 魔法释放失败: ${error.message}`;
            errorMessage.classList.remove("hidden");
        } finally {
            // 还原按钮状态
            btnGenerate.disabled = false;
            btnText.classList.remove("hidden");
            btnLoader.classList.add("hidden");
        }
    });
});
