import tempfile, wave
from pathlib import Path
import caption_ai_separated as c

def _wav(path, seconds=22, rate=100):
    with wave.open(str(path),'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate); w.writeframes(b'\0\0'*rate*seconds)

def test_overlapping_chunks_cover_boundaries(tmp_path):
    path=tmp_path/'a.wav'; _wav(path)
    with tempfile.TemporaryDirectory() as temp:
        chunks=c._split_wav(str(path),temp)
    assert [round(offset,1) for _,offset in chunks] == [0.0,8.5,17.0]

def test_merge_deduplicates_same_timed_word():
    left=[{'original':'impact','start':8.7,'end':9.0}]
    incoming=[{'original':'impact','start':8.72,'end':9.02},{'original':'line','start':9.1,'end':9.4}]
    assert [w['original'] for w in c._merge_timed_words(left,incoming)] == ['impact','line']
