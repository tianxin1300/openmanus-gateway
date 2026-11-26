#!/usr/bin/env python3
# workflow 里写死的是 python3 apply_v106.py，所以这个文件是“总开关”。
# 现状：仓库里的 worker.js / index.html 已经被别的会话大改过（临时分支、验证 / 部署工作流、工作台等），我之前的 v107~v109 补丁是按旧版本写的，
# 在这个版本上硬套可能对不上、甚至和已有功能重复。所以这一轮只跑只读诊断，把结果写进 diag/report.txt，对账之后再决定要不要套 v107~v109。
import os, runpy
here = os.path.dirname(os.path.abspath(__file__))
runpy.run_path(os.path.join(here, "diag_v110.py"), run_name="__main__")
print("v107~v109 补丁这一轮暂停（没有应用）：先对账仓库现状。")
