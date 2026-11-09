module.exports = {
    "defaults": {
        "speed": 3,
        "qualityMin": 50,
        "qualityMax": 80
    },
    "limits": {
        "speed": {
            "label": "PNG 速度",
            "min": 1,
            "max": 11
        },
        "qualityMin": {
            "label": "PNG 最低质量",
            "min": 0,
            "max": 100
        },
        "qualityMax": {
            "label": "PNG 最高质量",
            "min": 0,
            "max": 100
        }
    },
    "parameters": {
        "speed": {
            "hint": "数值越高速度越快。"
        },
        "qualityMin": {
            "hint": "最低质量不得高于最高质量；未达到时保留原图。"
        },
        "qualityMax": {
            "hint": "数值越高质量和体积通常越高。"
        }
    }
};
module.exports.validate = function (settings) {
        if (settings.qualityMin > settings.qualityMax) throw new Error('PNG 最低质量不能大于最高质量');
    };
