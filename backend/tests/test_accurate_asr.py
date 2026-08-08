from types import SimpleNamespace
import caption_ai_separated as c

def test_segment_timing_preserves_all_words_and_segment_bounds():
    r=SimpleNamespace(segments=[{'text':'No impact line missed','start':0.2,'end':2.2,'speaker':'A'}])
    words=c._segment_timed_words(r)
    assert [w['original'] for w in words] == ['No','impact','line','missed']
    assert words[0]['start'] == 0.2
    assert words[-1]['end'] == 2.2
    assert all(words[i]['end'] <= words[i+1]['start'] for i in range(len(words)-1))

def test_valid_accurate_words_requires_broad_timeline_coverage():
    short=[{'original':'hello','start':0,'end':1}]
    broad=[{'original':str(i),'start':i,'end':i+.5} for i in range(30)]
    assert not c._valid_accurate_words(short,37)
    assert c._valid_accurate_words(broad,37)

def test_repetitive_accurate_words_rejected():
    repeated=[{'original':x,'start':i*.2,'end':i*.2+.1} for i,x in enumerate(['haan','ji']*10)]
    assert not c._valid_accurate_words(repeated,4)
