import os
import io
import base64
import tempfile
import pathlib
from fastapi import FastAPI, HTTPException, Form
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import dashscope
from dashscope import ImageSynthesis

# 加载本地环境变量
load_dotenv()

app = FastAPI(title="Dream Canvas - API")

# 配置 CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 获取 API Key
DASHSCOPE_API_KEY = os.getenv("DASHSCOPE_API_KEY")
if DASHSCOPE_API_KEY and DASHSCOPE_API_KEY != "在这里填入你的_阿里百炼_API_Key":
    dashscope.api_key = DASHSCOPE_API_KEY

@app.post("/api/generate")
async def generate_image(
    prompt: str = Form(...),
    image_data: str = Form(...),    # 接收 Base64 编码的图片字符串
    ref_strength: float = Form(0.4) # 参考强度：越低=AI越自由发挥上色，越高=越贴近原图
):
    # 检查 API Key
    current_key = dashscope.api_key or os.getenv("DASHSCOPE_API_KEY")
    if not current_key or current_key == "在这里填入你的_阿里百炼_API_Key":
        return JSONResponse(
            status_code=400,
            content={"error": "未检测到有效的 DASHSCOPE_API_KEY，请在系统环境变量或 .env 中进行配置！"}
        )
    
    dashscope.api_key = current_key

    temp_file_path = None
    try:
        # 1. 解码前端传来的 Base64 画布图像
        if "," in image_data:
            image_data = image_data.split(",")[1]
        img_bytes = base64.b64decode(image_data)

        from dashscope.utils.oss_utils import OssUtils

        # 2. 保存为临时文件并上传至百炼 OSS
        with tempfile.NamedTemporaryFile(delete=False, suffix=".png") as temp_file:
            temp_file.write(img_bytes)
            temp_file_path = temp_file.name

        print(f"正在上传至 OSS: {temp_file_path}")
        oss_url, _ = OssUtils.upload(
            model="wanx-v1",
            file_path=os.path.abspath(temp_file_path),
            api_key=current_key
        )
        print(f"OSS 上传成功: {oss_url}, ref_strength={ref_strength}")

        # 3. wanx-v1 图生图：以用户简笔画为参考，美化成精美插画
        # ref_strength 控制对参考图的"忠实程度"：0.5~0.7 可在保留轮廓的同时大幅美化
        # 在提示词中只加最简单的风格引导，让模型以简笔画结构为主体进行上色美化
        enhanced_prompt = f"{prompt}，精美彩色插画，高质量"
        
        response = ImageSynthesis.call(
            model="wanx-v1",
            prompt=enhanced_prompt,
            ref_img=oss_url,
            ref_strength=ref_strength,
            api_key=current_key,
            n=1,
            size="1024*1024"
        )

        # 5. 解析返回结果
        if response.status_code == 200:
            output = response.output
            
            # 【极关键诊断逻辑】：DashScope 在算法出错时仍会返回 HTTP 200 状态码！
            # 我们必须在此判断 output.task_status 的实际取值
            task_status = None
            if hasattr(output, "task_status"):
                task_status = output.task_status
            elif isinstance(output, dict):
                task_status = output.get("task_status")
            
            # 如果检测到算法端返回 FAILED，立即截获并透传底层真实错误原因（如敏感词过滤、图片损坏等）
            if task_status == "FAILED":
                err_code = getattr(output, "code", "N/A")
                err_msg = getattr(output, "message", "算法内部处理错误")
                print(f"【DashScope 算法错误拦截】状态码: {err_code}, 错误信息: {err_msg}")
                raise Exception(f"AI模型运算失败: {err_msg} (代码: {err_code})")
            
            # 如果一切正常，开始提取结果 URL
            generated_url = None
            
            # 策略 A：强类型对象属性访问 (ImageSynthesisOutput)
            if hasattr(output, "results") and output.results:
                first_result = output.results[0]
                if hasattr(first_result, "url"):
                    generated_url = first_result.url
                elif isinstance(first_result, dict) and "url" in first_result:
                    generated_url = first_result["url"]
            
            # 策略 B：传统字典降级提取
            if not generated_url and isinstance(output, dict):
                output_list = output.get("results", [])
                if output_list and isinstance(output_list[0], dict):
                    generated_url = output_list[0].get("url")

            if generated_url:
                return {
                    "success": True,
                    "image_url": generated_url,
                    "prompt_used": prompt
                }
            else:
                # 将极其详尽的错误结构记录到本地文件供深入排查
                debug_info = f"状态: {task_status}\n结构: {output}\n类型: {type(output)}"
                with open("debug_output.txt", "w", encoding="utf-8") as df:
                    df.write(debug_info)
                raise Exception("API 处理结束，但响应中未包含图片。可能是模型生成超时，请稍后重试！")
        else:
            # 拦截 REST API 协议层级的错误
            error_msg = response.message if hasattr(response, 'message') else str(response)
            raise Exception(f"网络或鉴权失败: {error_msg} (状态码: {response.code if hasattr(response, 'code') else 'N/A'})")

    except Exception as e:
        print(f"图像生成错误: {str(e)}")
        return JSONResponse(
            status_code=500,
            content={"error": f"生成过程中发生错误: {str(e)}"}
        )
    finally:
        # 清理临时文件，避免占用硬盘空间
        if temp_file_path and os.path.exists(temp_file_path):
            try:
                os.remove(temp_file_path)
            except Exception as clean_err:
                print(f"清理临时文件失败: {clean_err}")

# 挂载前端静态页面目录
app.mount("/", StaticFiles(directory="static", html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
