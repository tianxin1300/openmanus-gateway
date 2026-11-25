#!/usr/bin/env python3
# workflow 里写死的是 python3 apply_v106.py，所以这里只负责按顺序转给后面的脚本：
#   v106 已经应用（commit 03dd3dc）；v107 = 任务拆解；v108 = 防死循环。每一个都可以重复运行，已经应用过会自动跳过。
import os, runpy
here = os.path.dirname(os.path.abspath(__file__))
for name in ("apply_v107.py", "apply_v108.py"):
    runpy.run_path(os.path.join(here, name), run_name="__main__")
