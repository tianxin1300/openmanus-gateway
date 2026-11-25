#!/usr/bin/env python3
# v106 已经应用到 worker.js（commit 03dd3dc）。workflow 里写死的是 python3 apply_v106.py，所以这里只转给 apply_v107.py。
import os, runpy
runpy.run_path(os.path.join(os.path.dirname(os.path.abspath(__file__)), "apply_v107.py"), run_name="__main__")
