/**
 * BBF: Brightness Binary Feature
 *
 * @author Eugene Zatepyakin / http://inspirit.ru/
 *
 * this code is a rewrite from https://github.com/liuliu/ccv implementation
 * @author Liu Liu / http://liuliu.me/
 *
 * The original paper refers to: YEF∗ Real-Time Object Detection, Yotam Abramson and Bruno Steux
 */

(function(global) {
    "use strict";
    //
    var bbf = (function() {

        var _group_func = function(r1, r2) {
            var distance = (r1.width * 0.25 + 0.5)|0;

            return r2.x <= r1.x + distance &&
                   r2.x >= r1.x - distance &&
                   r2.y <= r1.y + distance &&
                   r2.y >= r1.y - distance &&
                   r2.width <= (r1.width * 1.5 + 0.5)|0 &&
                   (r2.width * 1.5 + 0.5)|0 >= r1.width;
        }

        return {

            interval: 4,
            scale: 1.1486,
            next: 5,
            scale_to: 1,

            // make features local copy
            // to avoid array allocation with each scale
            // this is strange but array works faster than Int32 version???
            prepare_cascade: function(cascade) {
                var sn = cascade.stage_classifier.length;
                for (var j = 0; j < sn; j++) {
                    var orig_feature = cascade.stage_classifier[j].feature;
                    var f_cnt = cascade.stage_classifier[j].count;
                    var feature = cascade.stage_classifier[j]._feature = new Array(f_cnt);
                    for (var k = 0; k < f_cnt; k++) {
                        feature[k] = {"size" : orig_feature[k].size,
                                      "px" : new Array(orig_feature[k].size),
                                      "pz" : new Array(orig_feature[k].size),
                                      "nx" : new Array(orig_feature[k].size),
                                      "nz" : new Array(orig_feature[k].size)};
                    }
                }
            },

            build_pyramid: function(canvas, min_width, min_height, interval, do_grayscale) {
                if (typeof interval === "undefined") { interval = 4; }
                if (typeof do_grayscale === "undefined") { do_grayscale = true; }

                // need to convert to grayscale
                if(do_grayscale) {
                    var ctx_input = canvas.getContext('2d');
                    var in_size = canvas.width * canvas.height;
                    var img_data_input = ctx_input.getImageData(0, 0, canvas.width, canvas.height);
                    var data_input = img_data_input.data;
                    var data_u32 = new Uint32Array(data_input.buffer);
                    var gray_n = jsfeat.cache.get_buffer(in_size);
                    var gray_data = gray_n.u8;
                    jsfeat.imgproc.grayscale(data_input, gray_data);
                    var alpha = (0xff << 24);
                    var i = in_size,pix=0;
                    while (--i >= 0) {
                      pix = gray_data[i];
                      data_u32[i] = alpha | (pix << 16) | (pix << 8) | pix;
                    }
                    ctx_input.putImageData(img_data_input, 0, 0);
                    jsfeat.cache.put_buffer(gray_n);
                }
                //

                this.interval = interval;
                this.scale = Math.pow(2, 1 / (this.interval + 1));
                this.next = (this.interval + 1)|0;
                this.scale_to = (Math.log(Math.min(canvas.width / min_width, canvas.height / min_height)) / Math.log(this.scale))|0;

                var _canvas = document.createElement('canvas');
                _canvas.width = canvas.width;
                _canvas.height = canvas.height;
                var _ctx = _canvas.getContext('2d');

                var ret = new Array((this.scale_to + this.next * 2) * 4);
                ret[0] = { "width" : canvas.width,
                           "height" : canvas.height,
                           "data" : canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data };
                var nw, nh;
                for (i = 1; i <= this.interval; ++i) {
                    nw = (canvas.width / Math.pow(this.scale, i))|0;
                    nh = (canvas.height / Math.pow(this.scale, i))|0;
                    _ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, nw, nh);
                    ret[i * 4] = { "width" : nw,
                                   "height" : nh,
                                   "data" : _ctx.getImageData(0, 0, nw, nh).data };
                }
                for (i = this.next; i < this.scale_to + this.next * 2; ++i) {
                    nw = ret[i * 4 - this.next * 4].width >> 1;
                    nh = ret[i * 4 - this.next * 4].height >> 1;
                    _ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, nw, nh);
                    ret[i * 4] = { "width" : nw,
                                   "height" : nh,
                                   "data" : _ctx.getImageData(0, 0, nw, nh).data };
                }
                for (i = this.next * 2; i < this.scale_to + this.next * 2; ++i) {
                    nw = ret[i * 4 - this.next * 4].width >> 1;
                    nh = ret[i * 4 - this.next * 4].height >> 1;

                    _ctx.drawImage(canvas, 1, 0, canvas.width-1, canvas.height, 0, 0, nw-2, nh);

                    ret[i * 4 + 1] = { "width" : nw,
                                       "height" : nh,
                                       "data" : _ctx.getImageData(0, 0, nw, nh).data };

                    _ctx.drawImage(canvas, 0, 1, canvas.width, canvas.height-1, 0, 0, nw, nh-2);

                    ret[i * 4 + 2] = { "width" : nw,
                                       "height" : nh,
                                       "data" : _ctx.getImageData(0, 0, nw, nh).data };

                    _ctx.drawImage(canvas, 1, 1, canvas.width-1, canvas.height-1, 0, 0, nw-2, nh-2);

                    ret[i * 4 + 3] = { "width" : nw,
                                       "height" : nh,
                                       "data" : _ctx.getImageData(0, 0, nw, nh).data };
                }

                return ret;
            },

            detect: function(pyr, cascade) {
                var interval = this.interval;
                var scale = this.scale;
                var next = this.next;
                var scale_upto = this.scale_to;
                var i=0,j=0,k=0,n=0,x=0,y=0,q=0,sn=0,f_cnt=0,q_cnt=0,p=0,pmin=0,nmax=0,f=0,i4=0,qw=0,qh=0;
                var sum=0.0, alpha, feature, orig_feature, feature_k, feature_o, flag = true, shortcut=true;
                var scale_x = 1.0, scale_y = 1.0;
                var dx = [0, 1, 0, 1];
                var dy = [0, 0, 1, 1];
                var seq = [];

                var u8 = [], u8o = [0,0,0];
                var step = [0,0,0];
                var paddings = [0,0,0];

                for (i = 0; i < scale_upto; i++) {
                    i4 = (i<<2);
                    qw = pyr[i4 + (next << 3)].width - (cascade.width >> 2);
                    qh = pyr[i4 + (next << 3)].height - (cascade.height >> 2);
                    step[0] = pyr[i4].width << 2; step[1] = pyr[i4 + (next << 2)].width << 2; step[2] = pyr[i4 + (next << 3)].width << 2;
                    paddings[0] = (pyr[i4].width << 4) - (qw << 4);
                    paddings[1] = (pyr[i4 + (next << 2)].width << 3) - (qw << 3);
                    paddings[2] = (pyr[i4 + (next << 3)].width << 2) - (qw << 2);
                    sn = cascade.stage_classifier.length;
                    for (j = 0; j < sn; j++) {
                        orig_feature = cascade.stage_classifier[j].feature;
                        feature = cascade.stage_classifier[j]._feature;
                        f_cnt = cascade.stage_classifier[j].count;
                        for (k = 0; k < f_cnt; k++) {
                            feature_k = feature[k];
                            feature_o = orig_feature[k];
                            q_cnt = feature_o.size|0;
                            for (q = 0; q < q_cnt; q++) {
                                feature_k.px[q] = (feature_o.px[q] << 2) + feature_o.py[q] * step[feature_o.pz[q]];
                                feature_k.pz[q] = feature_o.pz[q];
                                feature_k.nx[q] = (feature_o.nx[q] << 2) + feature_o.ny[q] * step[feature_o.nz[q]];
                                feature_k.nz[q] = feature_o.nz[q];
                            }
                        }
                    }
                    u8[0] = pyr[i4].data; u8[1] = pyr[i4 + (next<<2)].data;
                    for (q = 0; q < 4; q++) {
                        u8[2] = pyr[i4 + (next<<3) + q].data;
                        u8o[0] = (dx[q]<<3) + dy[q] * (pyr[i4].width<<3); u8o[1] = (dx[q]<<2) + dy[q] * (pyr[i4 + (next<<2)].width<<2); u8o[2]=0;
                        for (y = 0; y < qh; y++) {
                            for (x = 0; x < qw; x++) {
                                sum = 0;
                                flag = true;
                                sn = cascade.stage_classifier.length;
                                for (j = 0; j < sn; j++) {
                                    sum = 0;
                                    alpha = cascade.stage_classifier[j].alpha;
                                    feature = cascade.stage_classifier[j]._feature;
                                    f_cnt = cascade.stage_classifier[j].count;
                                    for (k = 0; k < f_cnt; k++) {
                                        feature_k = feature[k];
                                        pmin = u8[feature_k.pz[0]][u8o[feature_k.pz[0]] + feature_k.px[0]];
                                        nmax = u8[feature_k.nz[0]][u8o[feature_k.nz[0]] + feature_k.nx[0]];
                                        if (pmin <= nmax) {
                                            sum += alpha[k << 1];
                                        } else {
                                            shortcut = true;
                                            q_cnt = feature_k.size;
                                            for (f = 0; f < q_cnt; f++) {
                                                if (feature_k.pz[f] >= 0) {
                                                    p = u8[feature_k.pz[f]][u8o[feature_k.pz[f]] + feature_k.px[f]];
                                                    if (p < pmin) {
                                                        if (p <= nmax) {
                                                            shortcut = false;
                                                            break;
                                                        }
                                                        pmin = p;
                                                    }
                                                }
                                                if (feature_k.nz[f] >= 0) {
                                                    n = u8[feature_k.nz[f]][u8o[feature_k.nz[f]] + feature_k.nx[f]];
                                                    if (n > nmax) {
                                                        if (pmin <= n) {
                                                            shortcut = false;
                                                            break;
                                                        }
                                                        nmax = n;
                                                    }
                                                }
                                            }
                                            sum += (shortcut) ? alpha[(k << 1) + 1] : alpha[k << 1];
                                        }
                                    }
                                    if (sum < cascade.stage_classifier[j].threshold) {
                                        flag = false;
                                        break;
                                    }
                                }
                                if (flag) {
                                    seq.push({"x" : (x * 4 + dx[q] * 2) * scale_x,
                                              "y" : (y * 4 + dy[q] * 2) * scale_y,
                                              "width" : cascade.width * scale_x,
                                              "height" : cascade.height * scale_y,
                                              "neighbor" : 1,
                                              "confidence" : sum});
                                }
                                u8o[0] += 16;
                                u8o[1] += 8;
                                u8o[2] += 4;
                            }
                            u8o[0] += paddings[0];
                            u8o[1] += paddings[1];
                            u8o[2] += paddings[2];
                        }
                    }
                    scale_x *= scale;
                    scale_y *= scale;
                }

                return seq;
            },

            // OpenCV method to group detected rectangles
            group_rectangles: function(rects, min_neighbors) {
                if (typeof min_neighbors === "undefined") { min_neighbors = 1; }
                var i, j, n = rects.length;
                var node = [];
                for (i = 0; i < n; ++i) {
                    node[i] = {"parent" : -1,
                               "element" : rects[i],
                               "rank" : 0};
                }
                for (i = 0; i < n; ++i) {
                    if (!node[i].element)
                        continue;
                    var root = i;
                    while (node[root].parent != -1)
                        root = node[root].parent;
                    for (j = 0; j < n; ++j) {
                        if( i != j && node[j].element && _group_func(node[i].element, node[j].element)) {
                            var root2 = j;

                            while (node[root2].parent != -1)
                                root2 = node[root2].parent;

                            if(root2 != root) {
                                if(node[root].rank > node[root2].rank)
                                    node[root2].parent = root;
                                else {
                                    node[root].parent = root2;
                                    if (node[root].rank == node[root2].rank)
                                    node[root2].rank++;
                                    root = root2;
                                }

                                /* compress path from node2 to the root: */
                                var temp, node2 = j;
                                while (node[node2].parent != -1) {
                                    temp = node2;
                                    node2 = node[node2].parent;
                                    node[temp].parent = root;
                                }

                                /* compress path from node to the root: */
                                node2 = i;
                                while (node[node2].parent != -1) {
                                    temp = node2;
                                    node2 = node[node2].parent;
                                    node[temp].parent = root;
                                }
                            }
                        }
                    }
                }
                var idx_seq = [];
                var class_idx = 0;
                for(i = 0; i < n; i++) {
                    j = -1;
                    var node1 = i;
                    if(node[node1].element) {
                        while (node[node1].parent != -1)
                            node1 = node[node1].parent;
                        if(node[node1].rank >= 0)
                            node[node1].rank = ~class_idx++;
                        j = ~node[node1].rank;
                    }
                    idx_seq[i] = j;
                }
                
                var comps = [];
                for (i = 0; i < class_idx+1; ++i) {
                    comps[i] = {"neighbors" : 0,
                                "x" : 0,
                                "y" : 0,
                                "width" : 0,
                                "height" : 0,
                                "confidence" : 0};
                }

                // count number of neighbors
                for(i = 0; i < n; ++i) {
                    var r1 = rects[i];
                    var idx = idx_seq[i];

                    if (comps[idx].neighbors == 0)
                        comps[idx].confidence = r1.confidence;

                    ++comps[idx].neighbors;

                    comps[idx].x += r1.x;
                    comps[idx].y += r1.y;
                    comps[idx].width += r1.width;
                    comps[idx].height += r1.height;
                    comps[idx].confidence = Math.max(comps[idx].confidence, r1.confidence);
                }

                var seq2 = [];
                // calculate average bounding box
                for(i = 0; i < class_idx; ++i) {
                    n = comps[i].neighbors;
                    if (n >= min_neighbors)
                        seq2.push({"x" : (comps[i].x * 2 + n) / (2 * n),
                                   "y" : (comps[i].y * 2 + n) / (2 * n),
                                   "width" : (comps[i].width * 2 + n) / (2 * n),
                                   "height" : (comps[i].height * 2 + n) / (2 * n),
                                   "neighbors" : comps[i].neighbors,
                                   "confidence" : comps[i].confidence});
                }

                var result_seq = [];
                n = seq2.length;
                // filter out small face rectangles inside large face rectangles
                for(i = 0; i < n; ++i) {
                    var r1 = seq2[i];
                    var flag = true;
                    for(j = 0; j < n; ++j) {
                        var r2 = seq2[j];
                        var distance = (r2.width * 0.25 + 0.5)|0;

                        if(i != j &&
                           r1.x >= r2.x - distance &&
                           r1.y >= r2.y - distance &&
                           r1.x + r1.width <= r2.x + r2.width + distance &&
                           r1.y + r1.height <= r2.y + r2.height + distance &&
                           (r2.neighbors > Math.max(3, r1.neighbors) || r1.neighbors < 3)) {
                            flag = false;
                            break;
                        }
                    }

                    if(flag)
                        result_seq.push(r1);
                }
                return result_seq;
            }

        };

    })();

    global.bbf = bbf;

})(jsfeat);
