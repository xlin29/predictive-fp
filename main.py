import json
from collections import defaultdict
import copy
import os
import re
import sys
import functions as F
from tqdm import tqdm

# Process data for a given number of months from the start month
num_of_months = int(sys.argv[1])
# Remove numeric values to avoid variations caused by browser updates
start_month = '2023-09'
# Only consider pairs with more than this number of devices
threshold = 5 
rm_attrs = ['http_userAgent_num', 'appVersion_num', 'http_browser_num', 'browser_num'] 
COMPANY = 'test'
user_dir = 'test_data/' # Directory containing fingerprinting data
# Fetch predictvie fp pairs
fp_change_pairs = F.get_unstable_pairs()

class TRACK:
    def __init__(self, data):
        self.visit = len(data)
        self.timestamp = []
        self.fp_diff = {"attr": [], "diff": []}
        self.identifier = []
        self.predictive_identifier = []
        self.data = data
        self.loginid = ''
        
    
    def start(self):
        """
        Processing fingerprinting data
        :return: re-idenfication results.
        """
        self.user = sorted(self.data, key=lambda x: x['timestamp'])
        self.detect_fp()
        self.verify()
        return self.res  

    
    def get_fp_id(self, fp):
        """
        Generate hashed identifier from fingerprints
        """
        values = [value for key, value in fp.items()]
        return self.hash_fp(values)
                     
    def add_unstable_fp_pair(self, fp):
        """
        Add predictive pairs to the fingerprints.
        """
        pair_with_change = fp
        pair_with_change['appVersion_num_com'] = F.compare_number_ls(fp['appVersion_num'], fp['userAgent_num'])
        for key, value in fp.items():
            if key in rm_attrs:
                continue
            val_with_change = value
            if key in fp_change_pairs:
                for each_attr, each_val in fp_change_pairs[key].items():
                    each_attr1 = each_attr.split('--')[0]
                    each_attr2 = each_attr.split('--')[1]
                    if each_attr1 == each_attr2:
                        continue
                    if value == each_attr1:
                        val_with_change += '--' + each_attr
                        if each_val < threshold:
                            break 
            pair_with_change[key]= val_with_change
        return pair_with_change

    def check_android_system(self, text):
        return bool(re.search(r"Android\s+\d+", text))

    def check_unstable_fp_pair(self, prior_fp, fp):
        pair_with_change = fp
        fp['appVersion_num_com'] = F.compare_number_ls(fp['appVersion_num'], fp['userAgent_num'])
        for key, value in fp.items():
            if key in rm_attrs:
                continue
            val_with_change = value
            prior_val = prior_fp[key]
            if '--' in str(prior_val):
                val_ls = prior_val.split('--')
                if value in val_ls:
                    val_with_change = prior_val 
            if key in ['system', 'http_system']:
                if (value.startswith('iOS') and prior_val.startswith('iOS')) or (self.check_android_system(value)):
                    val_with_change = prior_val
            pair_with_change[key] = val_with_change
        return pair_with_change


    def process_fp_data(self, fp, key):
        """
        Extract letters and numbers
        """
        letter_key = f'{key}_letter'
        number_key = f'{key}_num'
        fp[letter_key] = F.extract_letters(fp[key])
        fp[number_key] = F.extract_number_ls(fp[key])
        return fp
    
    def process_fp_data_str(self, fp, key):
        """
        # Extract letters
        # Extract numbers and join them with '~'
        """
        letter_key = f'{key}_letter'
        number_key = f'{key}_num'
        fp[letter_key] = F.extract_letters(fp[key])
        fp[number_key] = F.extract_number(fp[key])
        return fp
    
    def detect_fp(self):
        fp_base = {}
        prior_fp = {}
        prior_pair_fp = {}
        for index, each in enumerate(self.user):
            self.loginid = each['loginidName']
            self.timestamp.append(each['timestamp'])
            # Remove duplicate attributes
            for attribute in ['plugins_num', 'plugins', 'original-font', 'webgl']:
                del each['fp'][attribute]
            # Compute baseline identifier
            self.identifier.append(self.get_fp_id(each['fp']))
            # Predicitv-FP doesn't use canvas
            del each['fp']['canvas']
            fp = copy.deepcopy(each['fp'])
            # Remove hexid that appended to webgl_render
            fp['webgl_renderer'] = F.remove_hexid_webgl_renderer(each['fp']['webgl_renderer'])
            # Firefox new version v118, appends ", or similar" to the webgl_renderer value for specific webgl_renderers
            if 'similar' in fp['webgl_renderer']:
                fp['webgl_renderer'] = fp['webgl_renderer'].replace(', or similar', '')
            fp['platform_system_family'] = fp['platform'] + '~' + fp['system_family']
            fp['browser_family_system_family'] = fp['browser_family'] + '~' + fp['system_family']
            # Extract letters and numbers
            fp = self.process_fp_data(fp, 'userAgent')
            fp = self.process_fp_data(fp, 'appVersion')
            fp = self.process_fp_data(fp, 'http_userAgent')
            fp = self.process_fp_data_str(fp, 'http_browser')
            fp = self.process_fp_data_str(fp, 'browser')
            fp = self.process_fp_data_str(fp, 'http_system')
            fp = self.process_fp_data_str(fp, 'system')
            # Remove highly unstable attributes
            for attr in ['userAgent', 'appVersion', 'browser', 'http_browser', 'http_userAgent']:
                del fp[attr]
            # First visit
            if not prior_fp:
                fp = self.add_unstable_fp_pair(fp)
                prior_fp = fp
            else:
                fp = self.check_unstable_fp_pair(prior_fp, fp)
            pair_fp = copy.deepcopy(fp)
            # Predective-fp doesn't use numerical values
            for attr in ['http_system_num', 'system_num', 'appVersion_num','http_userAgent_num', 'userAgent_num', 'browser_num', 'http_browser_num']:
                del pair_fp[attr]
            json_string = json.dumps(pair_fp, sort_keys=True).encode('utf-8')
            predictive_id = self.hash_fp(json_string)
            self.predictive_identifier.append(predictive_id)
            # Analyze the changes from predictive fingerprints
            if prior_pair_fp:
                result = F.compare_dicts(prior_pair_fp, pair_fp)
                if result:
                    for key, (val1, val2) in result['modified'].items():
                        value_changes[str(key) + '-' + str(val1) + '**' + str(val2)].append(self.loginid)
                        predictive_by_key[key].append(self.loginid)
            prior_pair_fp = pair_fp
            # Analyze the changes from baseline
            if not index:
                fp_base = each['fp']
            else:
                fp_compare = each['fp']
                diff = self.dict_diff(fp_base, fp_compare)
                if diff:
                    self.fp_diff['attr'].extend(list(diff.keys()))
                    self.fp_diff['diff'].append(diff)
                    for key in diff.keys():
                        fp_diff_changes[key].append(self.loginid)
                fp_base = fp_compare
              
        if  self.fp_diff['attr'] and self.loginid:
            self.fp_diff['loginid'] = self.loginid
            # Log the baseline changes
            self.write_json(fp_diff_file, self.fp_diff)
            diff_set = set(self.fp_diff['attr'])
            for each in diff_set:
                total_fp_change[each] += 1
       
    
    def dict_diff(self, dc1, dc2):
        diff = defaultdict(F.def_dc)
        for key, value in dc1.items():
            if value != dc2[key]:
                diff[key] = [value, dc2[key]]
        return diff

    def hash_fp(self, fp):
        fp = str(fp)
        return F.get_sha256_hash(fp)

    def write_json(self, file, data):
        file.write(json.dumps(data)+'\n')
    
    def remove_consecutive_duplicates(self, lst):
        if not lst:  # Handle empty list
            return []
        result = [lst[0]]  # Start with the first element
        for i in range(1, len(lst)):
            if lst[i] != lst[i - 1]:  # Add element only if it's different from the previous one
                result.append(lst[i])
        return result

    def verify(self):
        self.res = {}
        self.predictive_identifier = list(set(self.predictive_identifier))
        self.identifier = list(set(self.identifier))
        # Track changes
        #self.identifier = self.remove_consecutive_duplicates(self.identifier)
        self.res['loginid'] = self.loginid
        self.res['visit'] = len(self.timestamp)
        track = [0,0]
        if len(self.identifier) == 1:
            track[0] = 1
        if len(self.predictive_identifier) == 1:
            track[1] = 1
        self.res['track'] = track
        self.res['timestamp'] = self.timestamp
        self.res['predictive_id'] = self.predictive_identifier
        self.res['id'] = self.identifier
        if self.res['visit'] < 1:
            return
        self.write_json(id_file, self.res)


def load_data(filename, start_month, num_months):
    with open(user_dir + filename, 'r') as f:
        data = []
        cookie_dc = defaultdict(list)
        monthly_counts = defaultdict(int)  # Dictionary to hold counts for each month

        start_year = int(start_month[:4])
        start_month_num = int(start_month[5:7])

        for line in f:
            record = F.load_json(line)
            record_year = int(record['timestamp'][:4])
            record_month_num = int(record['timestamp'][5:7])
            # Calculate month difference from start_month
            month_diff = (record_year - start_year) * 12 + (record_month_num - start_month_num)

            # Check if the record falls within the desired month range
            if 0 <= month_diff < num_months:
                monthly_counts[month_diff] += 1  # Increment count instead of storing record
                # Site fails to collect font fingerprints
                if record['fp']['font'] == '2e9e01ca':
                    continue
                data.append(record)
                cookie_dc[record['cookie']].append(record)

        if len(data) < 1:
            return None
        else:
            sorted_cookie = dict(sorted(cookie_dc.items(), key=lambda item: len(item[1]), reverse=True))
            # Exclude varying cookies to verify the same device
            first_key, first_value = next(iter(sorted_cookie.items()))
            return first_value


def worker(start_month, num_months):
    file_list = os.listdir(user_dir)
    for index, filename in enumerate(tqdm(file_list, desc="Processing Files")):
        data = load_data(filename, start_month, num_months)
        if data:
            track = TRACK(data)
            track.start()
    print(f"\nMonth #{num_months}")

   
def setup_globals():
    global single_visit, multi_visit
    global value_changes, predictive_by_key, fp_diff_changes, total_fp_change, fp_pair_changes
    single_visit = 0
    multi_visit = 0
    value_changes = defaultdict(list)
    predictive_by_key = defaultdict(list)
    fp_diff_changes = defaultdict(list)
    total_fp_change = defaultdict(F.def_value)
    fp_pair_changes = defaultdict(list)

def open_global_files(res_dir):
    global fp_diff_file, id_file
    fp_diff_file = open(os.path.join(res_dir, 'baseline_diff.json'), 'a')
    id_file = open(os.path.join(res_dir, 'id.json'), 'a')

def close_global_files():
    global fp_diff_file, id_file
    if fp_diff_file:
        fp_diff_file.close()
    if id_file:
        id_file.close()


def log_results(res_dir):
    sorted_predictive_changes = F.sort_cal_dict(predictive_by_key)
    sorted_fp_changes = F.sort_cal_dict(fp_diff_changes)
    print("\nChanges by Baseline from Highest to Lowest:")
    print(sorted_fp_changes)
    print("\nChanges by Predictive-FP from Highest to Lowest:")
    print(sorted_predictive_changes)
    F.write_new_json(f"{res_dir}predictive_changes.json", sorted_predictive_changes)
    F.write_new_json(f"{res_dir}baseline_changes.json", sorted_fp_changes)


def read_results(res_dir):
    """
    Output the results
    """
    print("\nReading results...")
    if not os.path.exists(id_file.name):
        print(f"Skipping {res_dir}: Missing required files.")
        return
    visit_total = 0
    count = 0
    predictive_success = 0
    fp_success = 0
    predictive_id = set()
    predictive_id_one = set()
    fp_id = set()
    fp_id_one = set()
    # Process id.json
    with open(id_file.name, 'r') as f:
        for line in f:
            data = json.loads(line)
            visit_total += data['visit']
            count += 1
            for each in data['predictive_id']:
                predictive_id.add(each)
            for each in data['id']:
                fp_id.add(each)
            if len(data['predictive_id']) == 1:
                predictive_success += 1
                predictive_id_one.add(data['predictive_id'][0])
            if len(data['id']) == 1:
                fp_success += 1
                fp_id_one.add(data['id'][0])

        # Compile results for this directory
        result = {
            'id_analysis': {
                'consistent_baseline_id': {
                    'count': fp_success,
                    'ratio': f"{(fp_success / count * 100):.2f}%" if count > 0 else "0.00%",
                },
                'consistent_predictive_id': {
                    'count': predictive_success,
                    'ratio': f"{(predictive_success / count * 100):.2f}%" if count > 0 else "0.00%",
                },
                'unique_id': {
                    'count': len(fp_id_one),
                    'ratio': f"{(len(fp_id_one) / count * 100):.2f}%" if count > 0 else "0.00%",
                },
                'unique_predictive_id': {
                    'count': len(predictive_id_one),
                    'ratio': f"{(len(predictive_id_one) / count * 100):.2f}%" if count > 0 else "0.00%",
                },
                'all_id': len(fp_id),
                'all_predictive_id': len(predictive_id),
            },
            'user_analysis': {
                'avg_visit': round(visit_total / count, 2) if count > 0 else 0,
                'users': count,
            }
        }
        print(json.dumps(result, indent=4))
        output_file = os.path.join(res_dir, 'result.json')
        with open(output_file, 'w') as file:
            json.dump(result, file, indent=4)
        print(f"Results written to {output_file}")
   

def main():
    for num_months in range(1, num_of_months+1):
        setup_globals()
        print(f"processing {num_months} month(s) from {start_month}")
        res_dir = f"result/{COMPANY}_{str(num_months)}m_result/"
        #Create the result directory
        if os.path.exists(res_dir):
            rm_cmd = f'rm -rf {res_dir}'
            os.system(rm_cmd)
        os.makedirs(res_dir)
        open_global_files(res_dir)
        worker(start_month, num_months)
        close_global_files()
        log_results(res_dir)
        read_results(res_dir)
        
        

if __name__ == '__main__':
    main()